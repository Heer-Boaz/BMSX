#pragma once

#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace bmsx {

class IrqController;
class CPU;

inline constexpr size_t DMA_JOB_QUEUE_CAPACITY = 16u;

struct DmaJobState {
	uint32_t src = 0;
	uint32_t dst = 0;
	uint32_t remaining = 0;
	uint32_t written = 0;
	bool clipped = false;
};

struct DmaControllerState {
	std::vector<DmaJobState> queue;
	int64_t budget = 0;
	int64_t carry = 0;
	uint32_t writtenValue = 0;
	bool writtenDirty = false;
	uint32_t sourceRegisterWord = 0;
	uint32_t destinationRegisterWord = 0;
	uint32_t lengthRegisterWord = 0;
	uint32_t controlRegisterWord = 0;
	uint32_t statusRegisterWord = 0;
	uint32_t writtenRegisterWord = 0;
};

class DmaController {
public:
	DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler);

	void setTiming(int64_t cpuHz, int64_t bytesPerSec, int64_t nowCycles);
	void setGxGpuReadReady(bool ready);
	void setGxGpuDmaWriteReady(bool ready);
	void setGxGpuCpuWriteReady(bool ready);
	bool isGxGpuCpuPortWriteReady() const { return m_gxGpuCpuWriteReady && m_gxGpuWriteJobCount == 0u; }
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	void startIo();
	void reset();
	DmaControllerState captureState() const;
	void restoreState(const DmaControllerState& state, int64_t nowCycles);

private:
	static constexpr uint32_t DMA_SERVICE_BATCH_BYTES = 64u;
	static void onCtrlWriteThunk(void* context, uint32_t addr, Value value);

	void scheduleNextService(int64_t nowCycles);
	bool hasPendingTransfer() const;
	void tick();
	uint32_t processJob(DmaJobState& job, int64_t budget);
	void finishIoSuccess(bool clipped);
	void finishIoError(bool clipped);
	uint32_t resolveMaxWritable(uint32_t dst) const;
	int64_t getPendingBytes() const;

	std::array<DmaJobState, DMA_JOB_QUEUE_CAPACITY> m_queue{};
	size_t m_queueHead = 0;
	size_t m_queueCount = 0;
	int64_t m_cpuHz = 1;
	int64_t m_bytesPerSec = 1;
	int64_t m_carry = 0;
	int64_t m_budget = 0;
	uint32_t m_writtenValue = 0;
	bool m_writtenDirty = false;
	bool m_gxGpuReadReady = false;
	bool m_gxGpuDmaWriteReady = false;
	bool m_gxGpuCpuWriteReady = false;
	size_t m_gxGpuWriteJobCount = 0;
	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	std::array<uint8_t, DMA_SERVICE_BATCH_BYTES> m_buffer{};
};

} // namespace bmsx
