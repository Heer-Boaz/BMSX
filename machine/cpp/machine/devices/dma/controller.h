#pragma once

#include "common/primitives.h"
#include "machine/devices/dma/registers.h"
#include "spec/bmsx/io.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class CPU;
class DeviceScheduler;
class IrqController;
class Memory;
enum class MemoryRegionKind;

struct DmaControllerState {
	DmaChannelStates channels{};
	u32 activeChannel = IO_DMA_CHANNEL_COUNT;
	u32 nextChannel = 0;
	u32 scheduledBlockWords = 0;
	i64 scheduledBlockCycles = 0;
	u32 scheduledReadAddressWord = 0;
	u32 scheduledWriteAddressWord = 0;
	u32 scheduledTransferCountWord = 0;
	u32 scheduledControlWord = 0;
	bool supervisorQuiesceRequested = false;
	bool supervisorAdmissionQuiesceRequested = false;
	DmaChannelStates userChannels{};
	u32 userNextChannel = 0;
};

class DmaController {
public:
	DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler);

	void setTiming(i64 ramCyclesPerWord, i64 ramBurstSetupCycles, i64 systemRomCyclesPerWord, i64 cartRomCyclesPerWord, i64 cartRomBurstSetupCycles, i64 nowCycles);
	void setRequestLines(u32 mask, u32 asserted);
	bool ownsReadPort(u32 address) const;
	bool ownsWritePort(u32 address) const;
	bool hasAdmittedWriteBlock(u32 address) const;
	void onService(i64 nowCycles);
	void reset();
	DmaControllerState captureState() const;
	void restoreState(const DmaControllerState& state, i64 nowCycles);
	void postLoad();
	void beginSupervisorControlQuiesce();
	void beginSupervisorQuiesce();
	bool supervisorQuiescent() const { return m_supervisorAdmissionQuiesceRequested && m_activeChannel == IO_DMA_CHANNEL_COUNT && !m_serviceActive; }
	void enterSupervisorContext();
	void leaveSupervisorContext();

private:
	static void onAddressWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);
	static void onChannelConfigWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);
	static void onTriggerWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);
	static bool triggerWriteReadyThunk(void* context, u32 addr, MappedBusSignals busSignals);

	void onTriggerWrite(u32 channel, u32 value);
	void arbitrate(i64 anchorCycle);
	void admitBlock(u32 channel, i64 anchorCycle);
	i64 regionSpanCycles(MemoryRegionKind region, u32 wordCount, bool regionStart) const;
	void finishChannel(u32 channel);
	void resumeCpuWriteIfPortReleased(u32 address);
	bool requestAsserted(u32 channel) const;
	bool requestLineAsserted(u32 request) const;
	static MappedBusSignals cartridgeSlotSignals(u32 request);
	bool busy(u32 channel) const;
	u32 channelReadAddress(u32 channel) const;
	u32 channelWriteAddress(u32 channel) const;
	void clearLiveTransfer();
	void clearUserContext();
	void clearAdmittedBlock();
	void notifySupervisorBoundary();

	i64 m_ramCyclesPerWord = 1;
	i64 m_ramBurstSetupCycles = 0;
	i64 m_systemRomCyclesPerWord = 1;
	i64 m_cartRomCyclesPerWord = 0;
	i64 m_cartRomBurstSetupCycles = 0;
	u32 m_activeChannel = IO_DMA_CHANNEL_COUNT;
	u32 m_nextChannel = 0;
	u32 m_scheduledBlockWords = 0;
	u32 m_scheduledReadAddressWord = 0;
	u32 m_scheduledWriteAddressWord = 0;
	u32 m_scheduledTransferCountWord = 0;
	u32 m_scheduledControlWord = 0;
	i64 m_serviceDeadline = 0;
	u32 m_requestLines = 0;
	bool m_serviceActive = false;
	bool m_restorePending = false;
	bool m_supervisorQuiesceRequested = false;
	bool m_supervisorAdmissionQuiesceRequested = false;
	DmaRegisterFile m_registers;
	DmaRegisterFile m_userRegisters;
	u32 m_userNextChannel = 0;
	Memory& m_memory;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
