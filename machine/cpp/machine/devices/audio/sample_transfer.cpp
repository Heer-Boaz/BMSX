#include "machine/devices/audio/sample_transfer.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/sample_memory.h"
#include "machine/devices/dma/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/budget.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuSampleTransfer::ApuSampleTransfer(
	Memory& memory,
	ApuSampleMemory& sampleMemory,
	DmaController& dma,
	DeviceScheduler& scheduler
)
	: m_memory(memory)
	, m_sampleMemory(sampleMemory)
	, m_dma(dma)
	, m_scheduler(scheduler) {}

void ApuSampleTransfer::reset() {
	cancelBatch();
	m_fifo.fill(0u);
	clearFifo();
	m_currentAddress = 0u;
	m_dataLatch = 0u;
	m_mode = APU_TRANSFER_MODE_STOP;
	m_timingCarry = 0;
	m_memory.writeIoValue(IO_APU_TRANSFER_ADDRESS, valueNumber(0.0));
	m_memory.writeIoValue(IO_APU_TRANSFER_DATA, valueNumber(0.0));
	m_memory.writeIoValue(IO_APU_TRANSFER_CONTROL, valueNumber(0.0));
	updateDmaRequests();
}

void ApuSampleTransfer::dispose() {
	cancelBatch();
	m_dma.setApuDmaWriteReady(false);
	m_dma.setApuDmaReadReady(false);
}

void ApuSampleTransfer::setTiming(i64 cpuHz, i64 nowCycles) {
	if (m_cpuHz == cpuHz) {
		return;
	}
	cancelBatch();
	m_cpuHz = cpuHz;
	m_timingCarry = 0;
	scheduleBatch(nowCycles);
}

auto ApuSampleTransfer::statusBits() const -> u32 {
	const bool readRequest = m_mode == APU_TRANSFER_MODE_DMA_READ
		&& m_fifoCount == APU_TRANSFER_FIFO_WORD_CAPACITY;
	const bool writeRequest = m_mode == APU_TRANSFER_MODE_DMA_WRITE && m_fifoCount == 0u;
	u32 status = 0u;
	if (readRequest || writeRequest) {
		status |= APU_STATUS_DMA_REQUEST;
	}
	if (readRequest) {
		status |= APU_STATUS_DMA_READ_REQUEST;
	}
	if (writeRequest) {
		status |= APU_STATUS_DMA_WRITE_REQUEST;
	}
	if (m_scheduledWords != 0u) {
		status |= APU_STATUS_TRANSFER_BUSY;
	}
	return status;
}

auto ApuSampleTransfer::captureState(i64 nowCycles) const -> ApuSampleTransferState {
	ApuSampleTransferState state;
	state.transferAddressWord = m_memory.readIoU32(IO_APU_TRANSFER_ADDRESS);
	state.transferDataWord = m_dataLatch;
	state.transferControlWord = m_memory.readIoU32(IO_APU_TRANSFER_CONTROL);
	state.currentAddress = m_currentAddress;
	state.fifoWords = m_fifo;
	state.fifoReadIndex = m_fifoReadIndex;
	state.fifoWriteIndex = m_fifoWriteIndex;
	state.fifoCount = m_fifoCount;
	state.timingCarry = m_timingCarry;
	state.scheduledWords = m_scheduledWords;
	state.scheduledCycles = m_scheduledWords == 0u ? 0 : m_serviceDeadline - nowCycles;
	return state;
}

void ApuSampleTransfer::restoreState(const ApuSampleTransferState& state, i64 nowCycles) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
	m_fifo = state.fifoWords;
	m_fifoReadIndex = state.fifoReadIndex;
	m_fifoWriteIndex = state.fifoWriteIndex;
	m_fifoCount = state.fifoCount;
	m_currentAddress = state.currentAddress;
	m_dataLatch = state.transferDataWord;
	m_mode = state.transferControlWord & APU_TRANSFER_MODE_MASK;
	m_timingCarry = state.timingCarry;
	m_scheduledWords = state.scheduledWords;
	m_serviceDeadline = nowCycles + state.scheduledCycles;
	m_memory.writeIoValue(IO_APU_TRANSFER_ADDRESS, valueNumber(static_cast<f64>(state.transferAddressWord)));
	m_memory.writeIoValue(IO_APU_TRANSFER_DATA, valueNumber(static_cast<f64>(state.transferDataWord)));
	m_memory.writeIoValue(IO_APU_TRANSFER_CONTROL, valueNumber(static_cast<f64>(state.transferControlWord)));
	updateDmaRequests();
	if (m_scheduledWords != 0u) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_APU_TRANSFER, m_serviceDeadline);
	}
}

void ApuSampleTransfer::writeAddress(u32 word) {
	m_currentAddress = word & (APU_SAMPLE_RAM_ADDRESS_MASK & ~(IO_WORD_SIZE - 1u));
}

auto ApuSampleTransfer::readCpuData() const -> u32 {
	return m_dataLatch;
}

auto ApuSampleTransfer::readDmaData() -> u32 {
	if (m_fifoCount != 0u) {
		m_dataLatch = popFifo();
		m_memory.writeIoValue(IO_APU_TRANSFER_DATA, valueNumber(static_cast<f64>(m_dataLatch)));
		updateDmaRequests();
		scheduleBatch(m_scheduler.currentNowCycles());
	}
	return m_dataLatch;
}

void ApuSampleTransfer::writeCpuData(u32 word) {
	m_dataLatch = word;
	if (m_mode == APU_TRANSFER_MODE_MANUAL_WRITE) {
		m_sampleMemory.writeWord(m_currentAddress, word);
		m_currentAddress = (m_currentAddress + IO_WORD_SIZE) & APU_SAMPLE_RAM_ADDRESS_MASK;
	}
}

void ApuSampleTransfer::writeDmaData(u32 word) {
	m_dataLatch = word;
	pushFifo(word);
	updateDmaRequests();
	scheduleBatch(m_scheduler.currentNowCycles());
}

void ApuSampleTransfer::writeControl(u32 word) {
	const u32 mode = word & APU_TRANSFER_MODE_MASK;
	if (mode != m_mode) {
		cancelBatch();
		clearFifo();
		m_timingCarry = 0;
		m_mode = mode;
	}
	updateDmaRequests();
	scheduleBatch(m_scheduler.currentNowCycles());
}

void ApuSampleTransfer::completeService() {
	const i64 completedDeadline = m_serviceDeadline;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
	completeBatch();
	scheduleBatch(completedDeadline);
}

void ApuSampleTransfer::clearFifo() {
	m_fifoReadIndex = 0u;
	m_fifoWriteIndex = 0u;
	m_fifoCount = 0u;
}

void ApuSampleTransfer::pushFifo(u32 word) {
	if (m_fifoCount == APU_TRANSFER_FIFO_WORD_CAPACITY) {
		return;
	}
	m_fifo[m_fifoWriteIndex] = word;
	m_fifoWriteIndex = (m_fifoWriteIndex + 1u) & (APU_TRANSFER_FIFO_WORD_CAPACITY - 1u);
	m_fifoCount += 1u;
}

auto ApuSampleTransfer::popFifo() -> u32 {
	const u32 word = m_fifo[m_fifoReadIndex];
	m_fifoReadIndex = (m_fifoReadIndex + 1u) & (APU_TRANSFER_FIFO_WORD_CAPACITY - 1u);
	m_fifoCount -= 1u;
	return word;
}

void ApuSampleTransfer::completeBatch() {
	const u32 transferWords = m_scheduledWords;
	m_scheduledWords = 0u;
	if (m_mode == APU_TRANSFER_MODE_DMA_READ) {
		for (u32 index = 0u; index < transferWords; index += 1u) {
			pushFifo(m_sampleMemory.readWord(m_currentAddress));
			m_currentAddress = (m_currentAddress + IO_WORD_SIZE) & APU_SAMPLE_RAM_ADDRESS_MASK;
		}
	} else {
		for (u32 index = 0u; index < transferWords; index += 1u) {
			m_sampleMemory.writeWord(m_currentAddress, popFifo());
			m_currentAddress = (m_currentAddress + IO_WORD_SIZE) & APU_SAMPLE_RAM_ADDRESS_MASK;
		}
	}
	updateDmaRequests();
}

void ApuSampleTransfer::scheduleBatch(i64 anchorCycle) {
	if (m_scheduledWords != 0u) {
		return;
	}
	u32 transferWords = 0u;
	if (m_mode == APU_TRANSFER_MODE_DMA_WRITE) {
		transferWords = m_fifoCount;
	} else if (m_mode == APU_TRANSFER_MODE_DMA_READ) {
		transferWords = APU_TRANSFER_FIFO_WORD_CAPACITY - m_fifoCount;
	}
	if (transferWords == 0u) {
		m_serviceDeadline = 0;
		return;
	}
	const i64 transferCycles = cyclesUntilBudgetUnits(
		m_cpuHz,
		APU_TRANSFER_WORDS_PER_SECOND,
		m_timingCarry,
		transferWords
	);
	m_timingCarry = (static_cast<i64>(APU_TRANSFER_WORDS_PER_SECOND) * transferCycles + m_timingCarry) % m_cpuHz;
	m_scheduledWords = transferWords;
	m_serviceDeadline = anchorCycle + transferCycles;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_APU_TRANSFER, m_serviceDeadline);
}

void ApuSampleTransfer::cancelBatch() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
	m_scheduledWords = 0u;
	m_serviceDeadline = 0;
}

void ApuSampleTransfer::updateDmaRequests() {
	m_dma.setApuDmaReadReady(m_mode == APU_TRANSFER_MODE_DMA_READ
		&& m_fifoCount == APU_TRANSFER_FIFO_WORD_CAPACITY);
	m_dma.setApuDmaWriteReady(m_mode == APU_TRANSFER_MODE_DMA_WRITE && m_fifoCount == 0u);
}

} // namespace bmsx
