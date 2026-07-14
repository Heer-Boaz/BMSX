#pragma once

#include "common/primitives.h"

namespace bmsx {

class CPU;
class DeviceScheduler;
class IrqController;
class Memory;

struct DmaControllerState {
	u32 readAddressWord = 0;
	u32 writeAddressWord = 0;
	u32 transferCountWord = 0;
	u32 controlWord = 0;
	u32 statusWord = 0;
	i64 timingCarry = 0;
	u32 scheduledGrantWords = 0;
	i64 scheduledGrantCycles = 0;
};

class DmaController {
public:
	DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler);

	void setTiming(i64 cpuHz, i64 wordsPerSec, i64 nowCycles);
	void setGxGpuReadReady(bool ready);
	void setGxGpuDmaWriteReady(bool ready);
	void setGxGpuCpuWriteReady(bool ready);
	void setGxGpuDmaDirection(u32 direction);
	bool isGxGpuCpuPortWriteReady() const;
	void onService(i64 nowCycles);
	void reset();
	DmaControllerState captureState() const;
	void restoreState(const DmaControllerState& state, i64 nowCycles);
	void postLoad();

private:
	static constexpr u32 DMA_SERVICE_GRANT_WORDS = 16u;

	static void onControlWriteThunk(void* context, u32 addr, u64 value);
	static void onWriteAddressWriteThunk(void* context, u32 addr, u64 value);
	static void onTriggerWriteThunk(void* context, u32 addr, u64 value);

	void onTriggerWrite(u32 value);
	void transferWord();
	void finishTransfer();
	void scheduleGrant(i64 anchorCycle);
	void cancelGrant();
	void requestInputChanged();
	bool requestAsserted() const;
	bool busy() const;
	bool ownsGxGpuWritePort() const;
	void resumeGxGpuCpuWrite();

	i64 m_cpuHz = 1;
	i64 m_wordsPerSec = 1;
	i64 m_timingCarry = 0;
	u32 m_scheduledGrantWords = 0;
	i64 m_serviceDeadline = 0;
	bool m_gxGpuReadReady = false;
	bool m_gxGpuDmaWriteReady = false;
	bool m_gxGpuCpuWriteReady = false;
	u32 m_gxGpuDmaDirection = 0;
	bool m_serviceActive = false;
	bool m_restorePending = false;
	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
