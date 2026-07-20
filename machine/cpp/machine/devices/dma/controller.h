#pragma once

#include "common/primitives.h"
#include "machine/memory/bus_signals.h"

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
	u32 scheduledBlockWords = 0;
	i64 scheduledBlockCycles = 0;
	u32 scheduledReadAddressWord = 0;
	u32 scheduledWriteAddressWord = 0;
	u32 scheduledTransferCountWord = 0;
	u32 scheduledControlWord = 0;
	bool supervisorQuiesceRequested = false;
	u32 userReadAddressWord = 0;
	u32 userWriteAddressWord = 0;
	u32 userTransferCountWord = 0;
	u32 userControlWord = 0;
	u32 userStatusWord = 0;
};

class DmaController {
public:
	DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler);

	void setTiming(i64 ramCyclesPerWord, i64 ramBurstSetupCycles, i64 romCyclesPerWord, i64 nowCycles);
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
	void finishTransfer();
	void admitBlock(i64 anchorCycle);
	void requestInputChanged();
	bool requestAsserted() const;
	bool busy() const;
	bool ownsGxGpuWritePort() const;
	void resumeCpuPortWrites();
	void clearLiveTransfer();
	void clearAdmittedBlock();
	void notifySupervisorBoundary();

	i64 m_ramCyclesPerWord = 1;
	i64 m_ramBurstSetupCycles = 0;
	i64 m_romCyclesPerWord = 0;
	u32 m_scheduledBlockWords = 0;
	u32 m_scheduledReadAddressWord = 0;
	u32 m_scheduledWriteAddressWord = 0;
	u32 m_scheduledTransferCountWord = 0;
	u32 m_scheduledControlWord = 0;
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
	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
