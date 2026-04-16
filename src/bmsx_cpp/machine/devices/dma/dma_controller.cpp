#include "machine/devices/dma/dma_controller.h"

#include "machine/bus/io.h"
#include "machine/memory/memory_map.h"

#include <algorithm>
#include <limits>
#include <utility>

namespace bmsx {
namespace {

constexpr uint32_t DMA_SERVICE_BATCH_BYTES = 64u;

}

DmaController::DmaController(
	Memory& memory,
	std::function<void(uint32_t)> raiseIrq,
	std::function<void(uint32_t src, size_t length)> sealVdpFifoDma,
	std::function<int64_t()> getNowCycles,
	std::function<void(int64_t deadlineCycles)> scheduleService,
	std::function<void()> cancelService
)
	: m_memory(memory)
	, m_raiseIrq(std::move(raiseIrq))
	, m_sealVdpFifoDma(std::move(sealVdpFifoDma))
	, m_getNowCycles(std::move(getNowCycles))
	, m_scheduleService(std::move(scheduleService))
	, m_cancelService(std::move(cancelService)) {}

bool DmaController::hasPendingVdpSubmit() const {
	for (const auto& state : m_channels) {
		if (state.hasActive && state.active.kind == DmaJob::Kind::Io && state.active.dst == IO_VDP_FIFO) {
			return true;
		}
		for (const auto& job : state.queue) {
			if (job.kind == DmaJob::Kind::Io && job.dst == IO_VDP_FIFO) {
				return true;
			}
		}
	}
	return false;
}

bool DmaController::hasPendingIsoTransfer() const {
	const auto& state = m_channels[static_cast<int>(Channel::Iso)];
	return state.hasActive || !state.queue.empty();
}

bool DmaController::hasPendingBulkTransfer() const {
	const auto& state = m_channels[static_cast<int>(Channel::Bulk)];
	return state.hasActive || !state.queue.empty();
}

uint32_t DmaController::pendingIsoBytes() const {
	return pendingBytesForChannel(Channel::Iso);
}

uint32_t DmaController::pendingBulkBytes() const {
	return pendingBytesForChannel(Channel::Bulk);
}

void DmaController::setTiming(int64_t cpuHz, int64_t isoBytesPerSec, int64_t bulkBytesPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_isoBytesPerSec = isoBytesPerSec;
	m_bulkBytesPerSec = bulkBytesPerSec;
	m_isoCarry = 0;
	m_bulkCarry = 0;
	m_channels[static_cast<int>(Channel::Iso)].budget = 0;
	m_channels[static_cast<int>(Channel::Bulk)].budget = 0;
	maybeScheduleNextService(nowCycles);
}

void DmaController::accrueCycles(int cycles, int64_t nowCycles) {
	if (cycles <= 0) {
		return;
	}
	accrueChannel(Channel::Iso, m_isoBytesPerSec, m_isoCarry, cycles);
	accrueChannel(Channel::Bulk, m_bulkBytesPerSec, m_bulkCarry, cycles);
	maybeScheduleNextService(nowCycles);
}

void DmaController::onService(int64_t nowCycles) {
	if (!hasPendingIsoTransfer() && !hasPendingBulkTransfer()) {
		m_cancelService();
		return;
	}
	bool ioWrittenDirty = false;
	bool imgWrittenDirty = false;
	tickChannel(Channel::Iso, ioWrittenDirty, imgWrittenDirty);
	tickChannel(Channel::Bulk, ioWrittenDirty, imgWrittenDirty);
	if (ioWrittenDirty) {
		m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(static_cast<double>(m_ioWrittenValue)));
	}
	if (imgWrittenDirty) {
		m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(static_cast<double>(m_imgWrittenValue)));
	}
	maybeScheduleNextService(nowCycles);
}

uint32_t DmaController::pendingBytesForChannel(Channel channel) const {
	const auto& state = m_channels[static_cast<int>(channel)];
	uint32_t pendingBytes = 0u;
	if (state.hasActive) {
		const DmaJob& job = state.active;
		pendingBytes += job.kind == DmaJob::Kind::Io
			? job.remaining
			: (static_cast<uint32_t>(job.plan.writeLen) - job.written);
	}
	for (const DmaJob& job : state.queue) {
		pendingBytes += job.kind == DmaJob::Kind::Io
			? job.remaining
			: (static_cast<uint32_t>(job.plan.writeLen) - job.written);
	}
	return pendingBytes;
}

void DmaController::enqueueImageCopy(const Memory::ImageWritePlan& plan, std::vector<uint8_t>&& pixels, std::function<void(bool error, bool clipped, std::exception_ptr fault)> onComplete) {
	DmaJob job;
	job.kind = DmaJob::Kind::Image;
	job.channel = Channel::Bulk;
	job.plan = plan;
	job.pixels = std::move(pixels);
	job.row = 0;
	job.rowOffset = 0;
	job.vramTarget = m_memory.isVramRange(plan.baseAddr, plan.writeLen > 0 ? plan.writeLen : 1);
	job.written = 0;
	job.clipped = plan.clipped;
	job.error = false;
	job.fault = nullptr;
	job.onComplete = std::move(onComplete);
	m_channels[static_cast<int>(Channel::Bulk)].queue.push_back(std::move(job));
	maybeScheduleNextService(m_getNowCycles());
}

void DmaController::reset() {
	m_isoCarry = 0;
	m_bulkCarry = 0;
	for (int i = 0; i < 2; i += 1) {
		m_channels[i].queue.clear();
		m_channels[i].hasActive = false;
		m_channels[i].budget = 0;
	}
	m_ioWrittenValue = 0;
	m_imgWrittenValue = 0;
	m_buffer.clear();
	m_cancelService();
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
}

void DmaController::tickChannel(Channel channel, bool& ioWrittenDirty, bool& imgWrittenDirty) {
	auto& state = m_channels[static_cast<int>(channel)];
	uint32_t budget = state.budget;
	while (budget > 0) {
		if (!state.hasActive) {
			if (state.queue.empty()) {
				return;
			}
			state.active = std::move(state.queue.front());
			state.queue.pop_front();
			state.hasActive = true;
		}
		auto& job = state.active;
		const uint32_t written = processJob(job, budget);
		budget -= written;
		if (job.kind == DmaJob::Kind::Io) {
			m_ioWrittenValue = job.written;
			ioWrittenDirty = true;
		}
		if (job.kind == DmaJob::Kind::Image) {
			m_imgWrittenValue = job.written;
			imgWrittenDirty = true;
		}
		if (isJobComplete(job)) {
			finishJob(job);
			state.hasActive = false;
			continue;
		}
		if (written == 0) {
			state.budget = budget;
			return;
		}
	}
	state.budget = budget;
}

uint32_t DmaController::processJob(DmaJob& job, uint32_t budget) {
	if (job.error) {
		return 0;
	}
	if (job.kind == DmaJob::Kind::Io) {
		uint32_t chunk = job.remaining > budget ? budget : job.remaining;
		if (chunk == 0) {
			return 0;
		}
		if (job.dst == IO_VDP_FIFO) {
			job.remaining -= chunk;
			job.written += chunk;
			return chunk;
		}
		if (m_memory.isVramRange(job.dst, 1)) {
			chunk &= ~3u;
			if (chunk == 0) {
				return 0;
			}
		}
		try {
			if (m_buffer.size() < chunk) {
				m_buffer.resize(chunk);
			}
			m_memory.readBytes(job.src, m_buffer.data(), chunk);
			m_memory.writeBytes(job.dst, m_buffer.data(), chunk);
		} catch (...) {
			job.error = true;
			job.fault = std::current_exception();
			return 0;
		}
		job.src += chunk;
		job.dst += chunk;
		job.remaining -= chunk;
		job.written += chunk;
		return chunk;
	}
	return processImageJob(job, budget);
}

uint32_t DmaController::processImageJob(DmaJob& job, uint32_t budget) {
	uint32_t remaining = budget;
	while (remaining > 0 && job.row < job.plan.writeHeight) {
		const uint32_t rowRemaining = job.plan.writeStride - job.rowOffset;
		uint32_t toCopy = remaining < rowRemaining ? remaining : rowRemaining;
		if (job.vramTarget) {
			toCopy &= ~3u;
			if (toCopy == 0) {
				return budget - remaining;
			}
		}
		const size_t srcOffset = static_cast<size_t>(job.row) * job.plan.sourceStride + job.rowOffset;
		const uint32_t dstAddr = job.plan.baseAddr + job.row * job.plan.targetStride + job.rowOffset;
		try {
			m_memory.writeBytes(dstAddr, job.pixels.data() + srcOffset, toCopy);
		} catch (...) {
			job.error = true;
			job.fault = std::current_exception();
			return budget - remaining;
		}
		remaining -= toCopy;
		job.rowOffset += toCopy;
		job.written += toCopy;
		if (job.rowOffset >= job.plan.writeStride) {
			job.row += 1;
			job.rowOffset = 0;
		}
	}
	return budget - remaining;
}

bool DmaController::isJobComplete(const DmaJob& job) const {
	if (job.error) {
		return true;
	}
	if (job.kind == DmaJob::Kind::Io) {
		return job.remaining == 0;
	}
	return job.row >= job.plan.writeHeight;
}

void DmaController::finishJob(DmaJob& job) {
	if (job.kind == DmaJob::Kind::Io) {
		finishIoJob(job);
		return;
	}
	if (job.onComplete) {
		job.onComplete(job.error, job.clipped, job.fault);
	}
}

void DmaController::tryStartIo() {
	const uint32_t ctrlValue = toU32(asNumber(m_memory.readValue(IO_DMA_CTRL)));
	if ((ctrlValue & DMA_CTRL_START) == 0) {
		return;
	}
	const uint32_t ctrl = ctrlValue;
	const uint32_t src = toU32(asNumber(m_memory.readValue(IO_DMA_SRC)));
	const uint32_t dst = toU32(asNumber(m_memory.readValue(IO_DMA_DST)));
	const uint32_t len = toU32(asNumber(m_memory.readValue(IO_DMA_LEN)));
	const bool vdpSubmit = dst == IO_VDP_FIFO;
	const bool strict = (ctrl & DMA_CTRL_STRICT) != 0;
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(static_cast<double>(ctrl & ~DMA_CTRL_START)));
	if (vdpSubmit && hasPendingVdpSubmit()) {
		finishIoRejected();
		return;
	}
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	if (vdpSubmit && (len & 3u) != 0u) {
		finishIoError(false);
		return;
	}

	const uint32_t maxWritable = resolveMaxWritable(dst);
	if (maxWritable == 0) {
		finishIoError(false);
		return;
	}
	uint32_t transferLen = len;
	bool clipped = false;
	if (transferLen > maxWritable) {
		clipped = true;
		if (strict || vdpSubmit) {
			finishIoError(true);
			return;
		}
		transferLen = maxWritable;
	}
	const uint32_t status = DMA_STATUS_BUSY | (clipped ? DMA_STATUS_CLIPPED : 0);
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(status)));
	if (transferLen == 0) {
		finishIoSuccess(clipped);
		return;
	}
	DmaJob job;
	job.kind = DmaJob::Kind::Io;
	job.channel = Channel::Bulk;
	job.src = src;
	job.dst = dst;
	job.remaining = transferLen;
	job.written = 0;
	job.clipped = clipped;
	job.strict = strict;
	job.error = false;
	m_ioWrittenValue = 0;
	m_channels[static_cast<int>(Channel::Bulk)].queue.push_back(std::move(job));
	maybeScheduleNextService(m_getNowCycles());
}

void DmaController::finishIoJob(DmaJob& job) {
	if (job.error) {
		finishIoError(job.clipped);
		return;
	}
	if (job.dst == IO_VDP_FIFO) {
		try {
			m_sealVdpFifoDma(job.src, job.written);
		} catch (...) {
			finishIoError(job.clipped);
			return;
		}
	}
	finishIoSuccess(job.clipped);
}

void DmaController::finishIoSuccess(bool clipped) {
	uint32_t status = DMA_STATUS_DONE;
	if (clipped) {
		status |= DMA_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(status)));
	m_raiseIrq(IRQ_DMA_DONE);
}

void DmaController::finishIoError(bool clipped) {
	uint32_t status = DMA_STATUS_DONE | DMA_STATUS_ERROR;
	if (clipped) {
		status |= DMA_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(status)));
	m_raiseIrq(IRQ_DMA_ERROR);
}

void DmaController::finishIoRejected() {
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(DMA_STATUS_REJECTED)));
}

void DmaController::accrueChannel(Channel channel, int64_t bytesPerSec, int64_t& carry, int cycles) {
	const uint32_t pendingBytes = pendingBytesForChannel(channel);
	auto& state = m_channels[static_cast<int>(channel)];
	if (pendingBytes == 0u) {
		carry = 0;
		state.budget = 0;
		return;
	}
	const int64_t numerator = bytesPerSec * static_cast<int64_t>(cycles) + carry;
	const int64_t wholeBytes = numerator / m_cpuHz;
	carry = numerator % m_cpuHz;
	if (wholeBytes <= 0) {
		return;
	}
	const int64_t maxGrant = static_cast<int64_t>(pendingBytes - state.budget);
	const int64_t granted = wholeBytes > maxGrant ? maxGrant : wholeBytes;
	state.budget += static_cast<uint32_t>(granted);
}

void DmaController::maybeScheduleNextService(int64_t nowCycles) {
	const bool pendingIso = hasPendingIsoTransfer();
	const bool pendingBulk = hasPendingBulkTransfer();
	if (!pendingIso && !pendingBulk) {
		m_cancelService();
		return;
	}
	int64_t nextDeadline = std::numeric_limits<int64_t>::max();
	if (pendingIso) {
		const uint32_t pendingBytes = pendingBytesForChannel(Channel::Iso);
		const uint32_t targetBytes = pendingBytes < DMA_SERVICE_BATCH_BYTES ? pendingBytes : DMA_SERVICE_BATCH_BYTES;
		if (m_channels[static_cast<int>(Channel::Iso)].budget >= targetBytes) {
			m_scheduleService(nowCycles);
			return;
		}
		const int64_t deadline = nowCycles + cyclesUntilBytes(m_isoBytesPerSec, m_isoCarry, targetBytes - m_channels[static_cast<int>(Channel::Iso)].budget);
		nextDeadline = deadline < nextDeadline ? deadline : nextDeadline;
	}
	if (pendingBulk) {
		const uint32_t pendingBytes = pendingBytesForChannel(Channel::Bulk);
		const uint32_t targetBytes = pendingBytes < DMA_SERVICE_BATCH_BYTES ? pendingBytes : DMA_SERVICE_BATCH_BYTES;
		if (m_channels[static_cast<int>(Channel::Bulk)].budget >= targetBytes) {
			m_scheduleService(nowCycles);
			return;
		}
		const int64_t deadline = nowCycles + cyclesUntilBytes(m_bulkBytesPerSec, m_bulkCarry, targetBytes - m_channels[static_cast<int>(Channel::Bulk)].budget);
		nextDeadline = deadline < nextDeadline ? deadline : nextDeadline;
	}
	m_scheduleService(nextDeadline);
}

int64_t DmaController::cyclesUntilBytes(int64_t bytesPerSec, int64_t carry, uint32_t targetBytes) const {
	const int64_t needed = static_cast<int64_t>(targetBytes) * m_cpuHz - carry;
	if (needed <= 0) {
		return 1;
	}
	const int64_t cycles = (needed + bytesPerSec - 1) / bytesPerSec;
	return cycles <= 0 ? 1 : cycles;
}

uint32_t DmaController::resolveMaxWritable(uint32_t dst) const {
	if (dst == IO_VDP_FIFO) {
		return VDP_STREAM_BUFFER_SIZE;
	}
	if (dst >= VRAM_SYSTEM_ATLAS_BASE && dst < VRAM_SYSTEM_ATLAS_BASE + VRAM_SYSTEM_ATLAS_SIZE) {
		return (VRAM_SYSTEM_ATLAS_BASE + VRAM_SYSTEM_ATLAS_SIZE) - dst;
	}
	if (dst >= VRAM_SKYBOX_BASE && dst < VRAM_SKYBOX_BASE + VRAM_SKYBOX_SIZE) {
		return (VRAM_SKYBOX_BASE + VRAM_SKYBOX_SIZE) - dst;
	}
	if (dst >= VRAM_PRIMARY_ATLAS_BASE && dst < VRAM_PRIMARY_ATLAS_BASE + VRAM_PRIMARY_ATLAS_SIZE) {
		return (VRAM_PRIMARY_ATLAS_BASE + VRAM_PRIMARY_ATLAS_SIZE) - dst;
	}
	if (dst >= VRAM_SECONDARY_ATLAS_BASE && dst < VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) {
		return (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE) - dst;
	}
	if (dst >= VRAM_FRAMEBUFFER_BASE && dst < VRAM_FRAMEBUFFER_BASE + VRAM_FRAMEBUFFER_SIZE) {
		return (VRAM_FRAMEBUFFER_BASE + VRAM_FRAMEBUFFER_SIZE) - dst;
	}
	if (dst >= VRAM_STAGING_BASE && dst < VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		return (VRAM_STAGING_BASE + VRAM_STAGING_SIZE) - dst;
	}
	if (dst >= OVERLAY_ROM_BASE && dst < OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) {
		return (OVERLAY_ROM_BASE + OVERLAY_ROM_SIZE) - dst;
	}
	if (dst >= RAM_BASE && dst < RAM_USED_END) {
		return RAM_USED_END - dst;
	}
	return 0;
}

} // namespace bmsx
