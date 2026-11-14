#pragma once

#include "common/primitives.h"
#include "machine/devices/dma/registers.h"
#include "machine/devices/dma/endpoints.h"
#include "spec/bmsx/io.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class CPU;
class DeviceScheduler;
class IrqController;
class Memory;
class GxGpu;
enum class MemoryRegionKind;

struct DmaControllerState {
	DmaChannelStates channels{};
	u32 activeChannel = IO_DMA_CHANNEL_COUNT;
	u32 nextChannel = 0;
	u32 scheduledBlockWords = 0;
	i64 scheduledBlockCycles = 0;
	bool supervisorQuiesceRequested = false;
	bool supervisorAdmissionQuiesceRequested = false;
	DmaChannelStates userChannels{};
	u32 userNextChannel = 0;
};

class DmaController {
public:
	DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler);

	void setTiming(i64 ramCyclesPerWord, i64 ramBurstSetupCycles, i64 systemRomCyclesPerWord, i64 cartRomCyclesPerWord, i64 cartRomBurstSetupCycles, i64 nowCycles);
	void setEndpointCapacity(DmaEndpoint endpoint, u32 words);
	void setEndpointRequests(DmaEndpoint first, u32 firstWords, DmaEndpoint second, u32 secondWords);
	void connectGpu(GxGpu& gpu) { m_gpu = &gpu; }
	bool ownsReadPort(u32 address) const;
	bool ownsWritePort(u32 address) const;
	bool hasAdmittedWriteBlock(u32 address) const;
	u32 gpuCommandServiceDemand() const;
	bool cpuBusHeld() const { return m_activeChannel != IO_DMA_CHANNEL_COUNT; }
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
	static void onChannelConfigWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);
	static void onTriggerWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);

	void onTriggerWrite(u32 channel, u32 value);
	void arbitrate(i64 anchorCycle);
	i64 regionSpanCycles(MemoryRegionKind region, u32 wordCount) const;
	void finishChannel(u32 channel, u32 status = DMA_STATUS_DONE);
	void resumeCpuWriteIfPortReleased(u32 address);
	bool busy(u32 channel) const;
	void clearLiveTransfer();
	void clearUserContext();
	void clearAdmittedBlock();
	void notifySupervisorBoundary();

	i64 m_ramCyclesPerWord = 1;
	i64 m_ramBurstSetupCycles = 0;
	i64 m_systemRomCyclesPerWord = 1;
	i64 m_cartRomCyclesPerWord = 1;
	i64 m_cartRomBurstSetupCycles = 0;
	u32 m_activeChannel = IO_DMA_CHANNEL_COUNT;
	u32 m_nextChannel = 0;
	u32 m_scheduledBlockWords = 0;
	i64 m_serviceDeadline = 0;
	std::array<u32, static_cast<u32>(DmaEndpoint::Memory) + 1u> m_endpointCapacity{};
	bool m_serviceActive = false;
	bool m_restorePending = false;
	bool m_supervisorQuiesceRequested = false;
	bool m_supervisorAdmissionQuiesceRequested = false;
	DmaRegisterFile m_registers;
	DmaRegisterFile m_userRegisters;
	u32 m_userNextChannel = 0;
	Memory& m_memory;
	GxGpu* m_gpu = nullptr;
	CPU& m_cpu;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
