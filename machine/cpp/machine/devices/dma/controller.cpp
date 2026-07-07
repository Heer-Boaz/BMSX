#include "machine/devices/dma/controller.h"

#include "common/endian.h"
#include "machine/bus/io.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/scheduler/budget.h"

#include <algorithm>
#include <limits>
#include <utility>

namespace bmsx {
DmaController::DmaController(
			Memory& memory,
			IrqController& irq,
			VDP& vdp,
			DeviceScheduler& scheduler
	)
			: m_memory(memory)
			, m_vdp(vdp)
			, m_irq(irq)
			, m_scheduler(scheduler) {
		m_memory.mapIoWrite(IO_DMA_CTRL, this, &DmaController::onCtrlWriteThunk);
	}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the DMA device instance.
void DmaController::onCtrlWriteThunk(void* context, uint32_t, Value) {
	static_cast<DmaController*>(context)->startIo();
}

bool DmaController::hasPendingTransfer(Channel channel) const {
	const auto& state = m_channels[static_cast<int>(channel)];
	return state.queueHead != state.queue.size();
}

void DmaController::setTiming(int64_t cpuHz, int64_t isoBytesPerSec, int64_t bulkBytesPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_isoBytesPerSec = isoBytesPerSec;
	m_bulkBytesPerSec = bulkBytesPerSec;
	m_isoCarry = 0;
	m_bulkCarry = 0;
	m_channels[static_cast<int>(Channel::Iso)].budget = 0;
	m_channels[static_cast<int>(Channel::Bulk)].budget = 0;
	scheduleNextService(nowCycles);
}

void DmaController::accrueCycles(int cycles, int64_t nowCycles) {
	if (cycles <= 0) {
		return;
	}
	accrueChannel(Channel::Iso, m_isoBytesPerSec, m_isoCarry, cycles);
	accrueChannel(Channel::Bulk, m_bulkBytesPerSec, m_bulkCarry, cycles);
	scheduleNextService(nowCycles);
}

void DmaController::onService(int64_t nowCycles) {
	if (!hasPendingTransfer(Channel::Iso) && !hasPendingTransfer(Channel::Bulk)) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		return;
	}
	tickChannel(Channel::Iso);
	tickChannel(Channel::Bulk);
	if (m_ioWrittenDirty) {
		m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(static_cast<double>(m_ioWrittenValue)));
		m_ioWrittenDirty = false;
	}
	if (m_imgWrittenDirty) {
		m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(static_cast<double>(m_imgWrittenValue)));
		m_imgWrittenDirty = false;
	}
	scheduleNextService(nowCycles);
}

uint32_t DmaController::getPendingBytesForChannel(Channel channel) const {
	const auto& state = m_channels[static_cast<int>(channel)];
	uint32_t pendingBytes = 0u;
	for (size_t index = state.queueHead; index < state.queue.size(); index += 1) {
		const DmaJob& job = state.queue[index];
		pendingBytes += job.kind == DmaJob::Kind::Io
			? job.remaining
			: (static_cast<uint32_t>(job.plan.writeLen) - job.written);
	}
	return pendingBytes;
}

void DmaController::enqueueImageCopy(const ImageCopyPlan& plan, std::vector<uint8_t>&& pixels, std::function<void(bool clipped)> onComplete) {
	DmaJob job;
	job.kind = DmaJob::Kind::Image;
	job.channel = Channel::Bulk;
	job.started = false;
	job.plan = plan;
	job.pixels = std::move(pixels);
	job.row = 0;
	job.rowOffset = 0;
	job.vramTarget = isVramMappedRange(plan.baseAddr, plan.writeLen > 0 ? plan.writeLen : 1);
	job.written = 0;
	job.clipped = plan.clipped;
	job.onComplete = std::move(onComplete);
	m_channels[static_cast<int>(Channel::Bulk)].queue.push_back(std::move(job));
	scheduleNextService(m_scheduler.currentNowCycles());
}

void DmaController::reset() {
	m_isoCarry = 0;
	m_bulkCarry = 0;
	for (int i = 0; i < 2; i += 1) {
		m_channels[i].queue.clear();
		m_channels[i].queueHead = 0;
		m_channels[i].budget = 0;
	}
	m_ioWrittenValue = 0;
	m_ioWrittenDirty = false;
	m_imgWrittenValue = 0;
	m_imgWrittenDirty = false;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
}

void DmaController::tickChannel(Channel channel) {
	auto& state = m_channels[static_cast<int>(channel)];
	uint32_t budget = state.budget;
	while (budget > 0) {
		if (state.queueHead == state.queue.size()) {
			state.budget = budget;
			return;
		}
		DmaJob& job = state.queue[state.queueHead];
		if (!job.started) {
			job.started = true;
			if (job.kind == DmaJob::Kind::Io && job.dst == IO_VDP_FIFO) {
				m_vdp.beginDmaSubmit();
			}
		}
		const uint32_t written = processJob(job, budget);
		budget -= written;
		if (job.kind == DmaJob::Kind::Io) {
			m_ioWrittenValue = job.written;
			m_ioWrittenDirty = true;
		}
		if (job.kind == DmaJob::Kind::Image) {
			m_imgWrittenValue = job.written;
			m_imgWrittenDirty = true;
		}
		if (isJobComplete(job)) {
			finishJob(job);
			state.queueHead += 1u;
			if (state.queueHead == state.queue.size()) {
				state.queue.clear();
				state.queueHead = 0;
			}
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
		const bool gp0Stream = job.dst == IO_GX_GPU_GP0;
		if (gp0Stream || isVramMappedRange(job.dst, 1u)) {
			chunk &= ~(IO_WORD_SIZE - 1u);
			if (chunk == 0u) {
				return 0u;
			}
		}
		if (chunk > m_buffer.size()) {
			chunk = static_cast<uint32_t>(m_buffer.size());
		}
		m_memory.readBytes(job.src, m_buffer.data(), chunk);
		if (gp0Stream) {
			for (uint32_t offset = 0u; offset < chunk; offset += IO_WORD_SIZE) {
				m_memory.writeMappedU32LE(IO_GX_GPU_GP0, readLE32(m_buffer.data() + offset));
			}
		} else {
			m_memory.writeBytes(job.dst, m_buffer.data(), chunk);
			job.dst += chunk;
		}
		job.src += chunk;
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
			toCopy &= ~(IO_WORD_SIZE - 1u);
			if (toCopy == 0) {
				return budget - remaining;
			}
		}
		const size_t srcOffset = static_cast<size_t>(job.row) * job.plan.sourceStride + job.rowOffset;
		const uint32_t dstAddr = job.plan.baseAddr + job.row * job.plan.targetStride + job.rowOffset;
		m_memory.writeBytes(dstAddr, job.pixels.data() + srcOffset, toCopy);
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
	job.onComplete(job.clipped);
}

void DmaController::startIo() {
	const uint32_t ctrlValue = m_memory.readIoU32(IO_DMA_CTRL);
	if ((ctrlValue & DMA_CTRL_START) == 0) {
		return;
	}
	const uint32_t ctrl = ctrlValue;
	const uint32_t src = m_memory.readIoU32(IO_DMA_SRC);
	const uint32_t dst = m_memory.readIoU32(IO_DMA_DST);
	const uint32_t len = m_memory.readIoU32(IO_DMA_LEN);
	const bool vdpSubmit = dst == IO_VDP_FIFO;
	const bool strict = (ctrl & DMA_CTRL_STRICT) != 0;
	m_memory.writeIoValue(IO_DMA_CTRL, valueNumber(static_cast<double>(ctrl & ~DMA_CTRL_START)));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	const uint32_t maxWritable = resolveMaxWritable(dst);
	if (maxWritable == 0) {
		finishIoError(false);
		return;
	}
	uint32_t transferLen = len;
	bool clipped = false;
	if (transferLen > maxWritable) {
		clipped = true;
		if (strict) {
			finishIoError(true);
			return;
		}
		transferLen = maxWritable;
	}
	if ((dst == IO_GX_GPU_GP0 || isVramMappedRange(dst, 1u)) && (transferLen & (IO_WORD_SIZE - 1u)) != 0u) {
		clipped = true;
		if (strict) {
			finishIoError(true);
			return;
		}
		transferLen &= ~(IO_WORD_SIZE - 1u);
	}
	const uint32_t status = DMA_STATUS_BUSY | (clipped ? DMA_STATUS_CLIPPED : 0);
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(status)));
	if (transferLen == 0) {
		if (vdpSubmit) {
			m_vdp.acceptSubmitAttempt();
		}
		finishIoSuccess(clipped);
		return;
	}
	DmaJob job;
	job.kind = DmaJob::Kind::Io;
	job.channel = Channel::Bulk;
	job.started = false;
	job.src = src;
	job.dst = dst;
	job.remaining = transferLen;
	job.written = 0;
	job.clipped = clipped;
	job.strict = strict;
	m_ioWrittenValue = 0;
	m_ioWrittenDirty = true;
	m_channels[static_cast<int>(Channel::Bulk)].queue.push_back(std::move(job));
	scheduleNextService(m_scheduler.currentNowCycles());
}

void DmaController::finishIoJob(DmaJob& job) {
	if (job.dst == IO_VDP_FIFO) {
		m_vdp.sealDmaTransfer(job.src, job.written);
	}
	finishIoSuccess(job.clipped);
}

void DmaController::finishIoSuccess(bool clipped) {
	uint32_t status = DMA_STATUS_DONE;
	if (clipped) {
		status |= DMA_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(status)));
	m_irq.raise(IRQ_DMA_DONE);
}

void DmaController::finishIoError(bool clipped) {
	uint32_t status = DMA_STATUS_DONE | DMA_STATUS_ERROR;
	if (clipped) {
		status |= DMA_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(status)));
	m_irq.raise(IRQ_DMA_ERROR);
}

void DmaController::accrueChannel(Channel channel, int64_t bytesPerSec, int64_t& carry, int cycles) {
	const uint32_t pendingBytes = getPendingBytesForChannel(channel);
	auto& state = m_channels[static_cast<int>(channel)];
	if (pendingBytes == 0u) {
		carry = 0;
		state.budget = 0;
		return;
	}
	BudgetAccrual accrual;
	accrueBudgetUnits(accrual, m_cpuHz, bytesPerSec, carry, cycles);
	carry = accrual.carry;
	if (accrual.wholeUnits <= 0) {
		return;
	}
	const int64_t maxGrant = static_cast<int64_t>(pendingBytes - state.budget);
	const int64_t granted = accrual.wholeUnits > maxGrant ? maxGrant : accrual.wholeUnits;
	state.budget += static_cast<uint32_t>(granted);
}

void DmaController::scheduleNextService(int64_t nowCycles) {
	const bool pendingIso = hasPendingTransfer(Channel::Iso);
	const bool pendingBulk = hasPendingTransfer(Channel::Bulk);
	if (!pendingIso && !pendingBulk) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		return;
	}
	int64_t nextDeadline = std::numeric_limits<int64_t>::max();
	if (pendingIso) {
		const uint32_t pendingBytes = getPendingBytesForChannel(Channel::Iso);
		const uint32_t targetBytes = pendingBytes < DMA_SERVICE_BATCH_BYTES ? pendingBytes : DMA_SERVICE_BATCH_BYTES;
		const DmaChannelState& state = m_channels[static_cast<int>(Channel::Iso)];
		if (state.budget >= targetBytes) {
			m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, nowCycles);
			return;
		}
		const int64_t deadline = nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_isoBytesPerSec, m_isoCarry, targetBytes - state.budget);
		nextDeadline = deadline < nextDeadline ? deadline : nextDeadline;
	}
	if (pendingBulk) {
		const uint32_t pendingBytes = getPendingBytesForChannel(Channel::Bulk);
		const uint32_t targetBytes = pendingBytes < DMA_SERVICE_BATCH_BYTES ? pendingBytes : DMA_SERVICE_BATCH_BYTES;
		const DmaChannelState& state = m_channels[static_cast<int>(Channel::Bulk)];
		if (state.budget >= targetBytes) {
			m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, nowCycles);
			return;
		}
		const int64_t deadline = nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_bulkBytesPerSec, m_bulkCarry, targetBytes - state.budget);
		nextDeadline = deadline < nextDeadline ? deadline : nextDeadline;
	}
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, nextDeadline);
}

uint32_t DmaController::resolveMaxWritable(uint32_t dst) const {
	if (dst == IO_VDP_FIFO) {
		return VDP_STREAM_BUFFER_SIZE;
	}
	if (dst == IO_GX_GPU_GP0) {
		return std::numeric_limits<uint32_t>::max();
	}
	if (const uint32_t vramRemaining = vramMappedRemainingBytes(dst)) {
		return vramRemaining;
	}
	if (dst >= RAM_BASE && dst < RAM_END) {
		return RAM_END - dst;
	}
	return 0;
}

} // namespace bmsx
