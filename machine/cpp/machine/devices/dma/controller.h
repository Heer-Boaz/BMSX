#pragma once

#include "common/primitives.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/region.h"

namespace bmsx {

class CPU;
class DeviceScheduler;
class IrqController;
class Memory;

constexpr u32 DMA_RAM_ROW_NONE = 0xffffffffu;

struct DmaControllerState {
	u32 readAddressWord = 0;
	u32 writeAddressWord = 0;
	u32 transferCountWord = 0;
	u32 controlWord = 0;
	u32 statusWord = 0;
	i64 timingCarry = 0;
	u32 scheduledBlockWords = 0;
	i64 scheduledBlockCycles = 0;
	bool supervisorQuiesceRequested = false;
	u32 userReadAddressWord = 0;
	u32 userWriteAddressWord = 0;
	u32 userTransferCountWord = 0;
	u32 userControlWord = 0;
	u32 userStatusWord = 0;
	i64 userTimingCarry = 0;
	u32 lastRamRowRead = DMA_RAM_ROW_NONE;
	u32 lastRamRowWrite = DMA_RAM_ROW_NONE;
};

class DmaController {
public:
	DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler);

	void setTiming(i64 cpuHz, i64 ramWordsPerSec, i64 ramRowReopenCycles, i64 romWaitCyclesPerWord, i64 nowCycles);
	void setGxGpuReadReady(bool ready);
	void setGxGpuDmaWriteReady(bool ready);
	void setGxGpuCpuWriteReady(bool ready);
	void setGxGpuDmaDirection(u32 direction);
	void setApuDmaReadReady(bool ready);
	void setApuDmaWriteReady(bool ready);
	bool isGxGpuCpuPortWriteReady() const;
	bool ownsApuDataPort() const;
	void onService(i64 nowCycles);
	void reset();
	DmaControllerState captureState() const;
	void restoreState(const DmaControllerState& state, i64 nowCycles);
	void postLoad();
	void beginSupervisorQuiesce();
	bool supervisorQuiescent() const { return m_scheduledBlockWords == 0u && !m_serviceActive; }
	bool hasAdmittedGxGpuWriteBlock() const;
	void enterSupervisorContext();
	void enterSupervisorFaultContext();
	void leaveSupervisorContext();

private:
	static void onControlWriteThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static void onAddressWriteThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static void onTriggerWriteThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static bool triggerWriteReadyThunk(void* context, u32 addr);

	void onTriggerWrite(u32 value);
	void transferWord(u32 transferCount, MappedBusSignals busSignals);
	void finishTransfer();
	void admitBlock(i64 anchorCycle);
	void scheduleAdmittedBlock(i64 anchorCycle, u32 blockWords);
	i64 ramBaseWordCycles(i64 carryAtBlockStart, i64& ramUnitsSoFar);
	i64 sideWordCycles(u32 address, MemoryRegionKind kind, u32& lastRow, i64 carryAtBlockStart, i64& ramUnitsSoFar);
	void requestInputChanged();
	bool requestAsserted() const;
	bool busy() const;
	bool ownsGxGpuWritePort() const;
	void resumeCpuPortWrites();
	void clearLiveTransfer();
	void notifySupervisorBoundary();

	i64 m_cpuHz = 1;
	i64 m_ramWordsPerSec = 1;
	i64 m_ramRowReopenCycles = 0;
	i64 m_romWaitCyclesPerWord = 0;
	i64 m_timingCarry = 0;
	u32 m_lastRamRowRead = DMA_RAM_ROW_NONE;
	u32 m_lastRamRowWrite = DMA_RAM_ROW_NONE;
	u32 m_scheduledBlockWords = 0;
	i64 m_serviceDeadline = 0;
	bool m_gxGpuReadReady = false;
	bool m_gxGpuDmaWriteReady = false;
	bool m_gxGpuCpuWriteReady = false;
	u32 m_gxGpuDmaDirection = 0;
	bool m_apuDmaReadReady = false;
	bool m_apuDmaWriteReady = false;
	bool m_serviceActive = false;
	bool m_restorePending = false;
	bool m_supervisorQuiesceRequested = false;
	u32 m_userReadAddressWord = 0;
	u32 m_userWriteAddressWord = 0;
	u32 m_userTransferCountWord = 0;
	u32 m_userControlWord = 0;
	u32 m_userStatusWord = 0;
	i64 m_userTimingCarry = 0;
	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
