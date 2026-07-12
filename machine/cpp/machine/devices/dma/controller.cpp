#include "machine/devices/dma/controller.h"

#include "common/endian.h"
#include "machine/bus/io.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/scheduler/budget.h"

#include <limits>

namespace bmsx {

DmaController::DmaController(Memory& memory, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_irq(irq)
	, m_scheduler(scheduler) {
	m_memory.mapIoWrite(IO_DMA_CTRL, this, &DmaController::onCtrlWriteThunk);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the DMA device instance.
void DmaController::onCtrlWriteThunk(void* context, uint32_t, Value) {
	static_cast<DmaController*>(context)->startIo();
}

bool DmaController::hasPendingTransfer() const {
	return m_queueCount != 0u;
}

void DmaController::setTiming(int64_t cpuHz, int64_t bytesPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_bytesPerSec = bytesPerSec;
	m_carry = 0;
	m_budget = 0;
	scheduleNextService(nowCycles);
}

void DmaController::setGxGpuReadReady(bool ready) {
	if (m_gxGpuReadReady == ready) {
		return;
	}
	m_gxGpuReadReady = ready;
	if (m_queueCount != 0u && m_queue[m_queueHead].src == IO_GX_GPU_GP0) {
		scheduleNextService(m_scheduler.currentNowCycles());
	}
}

void DmaController::setGxGpuWriteReady(bool ready) {
	if (m_gxGpuWriteReady == ready) {
		return;
	}
	m_gxGpuWriteReady = ready;
	if (m_queueCount != 0u && m_queue[m_queueHead].dst == IO_GX_GPU_GP0) {
		scheduleNextService(m_scheduler.currentNowCycles());
	}
}

void DmaController::accrueCycles(int cycles, int64_t nowCycles) {
	if (cycles <= 0) {
		return;
	}
	const int64_t pendingBytes = getPendingBytes();
	if (pendingBytes == 0) {
		m_carry = 0;
		m_budget = 0;
		scheduleNextService(nowCycles);
		return;
	}
	BudgetAccrual accrual;
	accrueBudgetUnits(accrual, m_cpuHz, m_bytesPerSec, m_carry, cycles);
	m_carry = accrual.carry;
	if (accrual.wholeUnits > 0) {
		const int64_t maxGrant = pendingBytes - m_budget;
		const int64_t granted = accrual.wholeUnits > maxGrant ? maxGrant : accrual.wholeUnits;
		m_budget += granted;
	}
	scheduleNextService(nowCycles);
}

void DmaController::onService(int64_t nowCycles) {
	if (!hasPendingTransfer()) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		return;
	}
	tick();
	if (m_writtenDirty) {
		m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(static_cast<double>(m_writtenValue)));
		m_writtenDirty = false;
	}
	scheduleNextService(nowCycles);
}

int64_t DmaController::getPendingBytes() const {
	int64_t pendingBytes = 0;
	for (size_t offset = 0u; offset < m_queueCount; offset += 1u) {
		pendingBytes += m_queue[(m_queueHead + offset) % DMA_JOB_QUEUE_CAPACITY].remaining;
	}
	return pendingBytes;
}

void DmaController::reset() {
	m_carry = 0;
	m_queueHead = 0;
	m_queueCount = 0;
	m_budget = 0;
	m_writtenValue = 0;
	m_writtenDirty = false;
	m_gxGpuReadReady = false;
	m_gxGpuWriteReady = false;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
}

void DmaController::tick() {
	int64_t budget = m_budget;
	while (budget > 0) {
		DmaJobState& job = m_queue[m_queueHead];
		const uint32_t written = processJob(job, budget);
		budget -= written;
		m_writtenValue = job.written;
		m_writtenDirty = true;
		if (job.remaining == 0u) {
			finishIoSuccess(job.clipped);
			m_queueHead = (m_queueHead + 1u) % DMA_JOB_QUEUE_CAPACITY;
			m_queueCount -= 1u;
			if (m_queueCount == 0u) {
				m_queueHead = 0;
				m_carry = 0;
				m_budget = 0;
				return;
			}
			continue;
		}
		if (written == 0u) {
			m_budget = budget;
			return;
		}
	}
	m_budget = budget;
}

uint32_t DmaController::processJob(DmaJobState& job, int64_t budget) {
	if (job.dst == IO_GX_GPU_GP0 && !m_gxGpuWriteReady) {
		return 0u;
	}
	uint32_t chunk = static_cast<int64_t>(job.remaining) > budget ? static_cast<uint32_t>(budget) : job.remaining;
	if (job.src == IO_GX_GPU_GP0 || job.dst == IO_GX_GPU_GP0) {
		chunk &= ~(IO_WORD_SIZE - 1u);
		if (chunk == 0u) {
			return 0u;
		}
	}
	if (chunk > m_buffer.size()) {
		chunk = static_cast<uint32_t>(m_buffer.size());
	}
	if (job.src == IO_GX_GPU_GP0) {
		uint32_t transferred = 0u;
		while (transferred < chunk && m_gxGpuReadReady) {
			const uint32_t word = m_memory.readMappedU32LE(IO_GX_GPU_GP0);
			if (job.dst == IO_GX_GPU_GP0) {
				m_memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
			} else {
				m_memory.writeMappedU32LE(job.dst + transferred, word);
			}
			transferred += IO_WORD_SIZE;
		}
		if (job.dst != IO_GX_GPU_GP0) {
			job.dst += transferred;
		}
		job.remaining -= transferred;
		job.written += transferred;
		return transferred;
	}
	m_memory.readBytes(job.src, m_buffer.data(), chunk);
	if (job.dst == IO_GX_GPU_GP0) {
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

void DmaController::startIo() {
	const uint32_t ctrl = m_memory.readIoU32(IO_DMA_CTRL);
	if ((ctrl & DMA_CTRL_START) == 0u) {
		return;
	}
	const uint32_t src = m_memory.readIoU32(IO_DMA_SRC);
	const uint32_t dst = m_memory.readIoU32(IO_DMA_DST);
	const uint32_t len = m_memory.readIoU32(IO_DMA_LEN);
	const bool strict = (ctrl & DMA_CTRL_STRICT) != 0u;
	m_memory.writeIoValue(IO_DMA_CTRL, valueNumber(static_cast<double>(ctrl & ~DMA_CTRL_START)));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	const uint32_t maxWritable = resolveMaxWritable(dst);
	if (maxWritable == 0u) {
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
	if ((src == IO_GX_GPU_GP0 || dst == IO_GX_GPU_GP0) && (transferLen & (IO_WORD_SIZE - 1u)) != 0u) {
		clipped = true;
		if (strict) {
			finishIoError(true);
			return;
		}
		transferLen &= ~(IO_WORD_SIZE - 1u);
	}
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(DMA_STATUS_BUSY | (clipped ? DMA_STATUS_CLIPPED : 0u))));
	if (transferLen == 0u) {
		finishIoSuccess(clipped);
		return;
	}
	DmaJobState job;
	job.src = src;
	job.dst = dst;
	job.remaining = transferLen;
	job.clipped = clipped;
	if (m_queueCount == DMA_JOB_QUEUE_CAPACITY) {
		finishIoError(false);
		return;
	}
	m_writtenValue = 0;
	m_writtenDirty = true;
	m_queue[(m_queueHead + m_queueCount) % DMA_JOB_QUEUE_CAPACITY] = job;
	m_queueCount += 1u;
	scheduleNextService(m_scheduler.currentNowCycles());
}

void DmaController::finishIoSuccess(bool clipped) {
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(DMA_STATUS_DONE | (clipped ? DMA_STATUS_CLIPPED : 0u))));
	m_irq.raise(IRQ_DMA_DONE);
}

void DmaController::finishIoError(bool clipped) {
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(DMA_STATUS_DONE | DMA_STATUS_ERROR | (clipped ? DMA_STATUS_CLIPPED : 0u))));
	m_irq.raise(IRQ_DMA_ERROR);
}

DmaControllerState DmaController::captureState() const {
	DmaControllerState state;
	state.queue.reserve(m_queueCount);
	for (size_t offset = 0u; offset < m_queueCount; offset += 1u) {
		state.queue.push_back(m_queue[(m_queueHead + offset) % DMA_JOB_QUEUE_CAPACITY]);
	}
	state.budget = m_budget;
	state.carry = m_carry;
	state.writtenValue = m_writtenValue;
	state.writtenDirty = m_writtenDirty;
	state.sourceRegisterWord = m_memory.readIoU32(IO_DMA_SRC);
	state.destinationRegisterWord = m_memory.readIoU32(IO_DMA_DST);
	state.lengthRegisterWord = m_memory.readIoU32(IO_DMA_LEN);
	state.controlRegisterWord = m_memory.readIoU32(IO_DMA_CTRL);
	state.statusRegisterWord = m_memory.readIoU32(IO_DMA_STATUS);
	state.writtenRegisterWord = m_memory.readIoU32(IO_DMA_WRITTEN);
	return state;
}

void DmaController::restoreState(const DmaControllerState& state, int64_t nowCycles) {
	for (size_t index = 0u; index < state.queue.size(); index += 1u) {
		m_queue[index] = state.queue[index];
	}
	m_queueHead = 0u;
	m_queueCount = state.queue.size();
	m_budget = state.budget;
	m_carry = state.carry;
	m_writtenValue = state.writtenValue;
	m_writtenDirty = state.writtenDirty;
	m_memory.writeValue(IO_DMA_SRC, valueNumber(static_cast<double>(state.sourceRegisterWord)));
	m_memory.writeValue(IO_DMA_DST, valueNumber(static_cast<double>(state.destinationRegisterWord)));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(static_cast<double>(state.lengthRegisterWord)));
	m_memory.writeIoValue(IO_DMA_CTRL, valueNumber(static_cast<double>(state.controlRegisterWord)));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(static_cast<double>(state.statusRegisterWord)));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(static_cast<double>(state.writtenRegisterWord)));
	scheduleNextService(nowCycles);
}

void DmaController::scheduleNextService(int64_t nowCycles) {
	if (!hasPendingTransfer()) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		return;
	}
	if ((m_queue[m_queueHead].src == IO_GX_GPU_GP0 && !m_gxGpuReadReady)
		|| (m_queue[m_queueHead].dst == IO_GX_GPU_GP0 && !m_gxGpuWriteReady)) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		return;
	}
	const int64_t pendingBytes = getPendingBytes();
	const int64_t targetBytes = pendingBytes < DMA_SERVICE_BATCH_BYTES ? pendingBytes : DMA_SERVICE_BATCH_BYTES;
	if (m_budget >= targetBytes) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(
		DEVICE_SERVICE_DMA,
		nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_bytesPerSec, m_carry, targetBytes - m_budget)
	);
}

uint32_t DmaController::resolveMaxWritable(uint32_t dst) const {
	if (dst == IO_GX_GPU_GP0) {
		return std::numeric_limits<uint32_t>::max();
	}
	if (dst >= RAM_BASE && dst < RAM_END) {
		return RAM_END - dst;
	}
	return 0u;
}

} // namespace bmsx
