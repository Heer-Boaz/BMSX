#pragma once

#include "common/primitives.h"
#include "machine/devices/audio/sample_transfer.h"
#include "machine/memory/bus_signals.h"
#include "machine/scheduler/budget.h"

namespace bmsx {

class ApuActiveSlots;
class ApuCommandFifo;
class ApuOutputMixer;
class ApuSampleMemory;
class DeviceScheduler;
class DmaController;
class Memory;

class ApuServiceClock final {
public:
	ApuServiceClock(
		Memory& memory,
		ApuSampleMemory& sampleMemory,
		DmaController& dma,
		DeviceScheduler& scheduler,
		const ApuCommandFifo& commandFifo,
		ApuActiveSlots& activeSlots,
		const ApuOutputMixer& audioOutput
	);

	void reset(i64 nowCycles);
	void dispose();
	i64 captureSampleCarry() const;
	i64 captureSampleSequence() const;
	[[nodiscard]] auto captureSampleTransferState(i64 nowCycles) const -> ApuSampleTransferState;
	void restore(
		i64 sampleCarry,
		i64 sampleSequence,
		const ApuSampleTransferState& sampleTransferState,
		i64 nowCycles
	);
	void setCpuHz(i64 cpuHz, i64 nowCycles);
	void synchronize(i64 nowCycles);
	void scheduleNext(i64 nowCycles);
	[[nodiscard]] auto sampleTransferStatusBits() const -> u32;

private:
	static u64 readTransferDataThunk(void* context, u32 addr, MappedBusSignals busSignals);
	static void writeTransferAddressThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static void writeTransferDataThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);
	static bool transferDataWriteReadyThunk(void* context, u32 addr);
	static void writeTransferControlThunk(void* context, u32 addr, u64 value, MappedBusSignals busSignals);

	void synchronizeBeforeTransferAccess(i64 nowCycles);
	void advanceVoicesTo(i64 cycle);

	DeviceScheduler& m_scheduler;
	const ApuCommandFifo& m_commandFifo;
	ApuActiveSlots& m_activeSlots;
	const ApuOutputMixer& m_audioOutput;
	DmaController& m_dma;
	ApuSampleTransfer m_sampleTransfer;
	i64 m_cpuHz;
	i64 m_sampleCarry = 0;
	i64 m_sampleSequence = 0;
	i64 m_lastCycle = 0;
	BudgetAccrual m_budgetAccrual{};
};

} // namespace bmsx
