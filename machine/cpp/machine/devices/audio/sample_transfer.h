#pragma once

#include "common/primitives.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/save_state.h"

#include <array>

namespace bmsx {

class ApuSampleMemory;
class ApuServiceClock;
class DeviceScheduler;
class DmaController;
class Memory;

class ApuSampleTransfer final {
	friend class ApuServiceClock;

private:
	ApuSampleTransfer(Memory& memory, ApuSampleMemory& sampleMemory, DmaController& dma, DeviceScheduler& scheduler);

	void reset();
	void dispose();
	void setTiming(i64 cpuHz, i64 nowCycles);
	[[nodiscard]] auto statusBits() const -> u32;
	[[nodiscard]] auto captureState(i64 nowCycles) const -> ApuSampleTransferState;
	void restoreState(const ApuSampleTransferState& state, i64 nowCycles);

	void writeAddress(u32 word);
	[[nodiscard]] auto readCpuData() const -> u32;
	[[nodiscard]] auto readDmaData(bool blockEnd) -> u32;
	void writeCpuData(u32 word);
	void writeDmaData(u32 word, bool blockEnd);
	void writeControl(u32 word);
	void completeService();
	void clearFifo();
	void pushFifo(u32 word);
	[[nodiscard]] auto popFifo() -> u32;
	void completeBatch();
	void scheduleBatch(i64 anchorCycle);
	void cancelBatch();
	void updateDmaRequests();

	Memory& m_memory;
	ApuSampleMemory& m_sampleMemory;
	DmaController& m_dma;
	DeviceScheduler& m_scheduler;
	std::array<u32, APU_TRANSFER_FIFO_WORD_CAPACITY> m_fifo{};
	u32 m_fifoReadIndex = 0;
	u32 m_fifoWriteIndex = 0;
	u32 m_fifoCount = 0;
	u32 m_transferAddressWord = 0;
	u32 m_transferControlWord = 0;
	u32 m_currentAddress = 0;
	u32 m_dataLatch = 0;
	u32 m_mode = APU_TRANSFER_MODE_STOP;
	i64 m_cpuHz = 1;
	i64 m_timingCarry = 0;
	u32 m_scheduledWords = 0;
	i64 m_serviceDeadline = 0;
};

} // namespace bmsx
