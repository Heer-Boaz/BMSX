#include "machine/devices/audio/service_clock.h"

#include "spec/bmsx/io.h"
#include "machine/devices/audio/active_slots.h"
#include "machine/devices/audio/command_fifo.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/sample_memory.h"
#include "machine/devices/dma/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuServiceClock::ApuServiceClock(
	Memory& memory,
	ApuSampleMemory& sampleMemory,
	DmaController& dma,
	DeviceScheduler& scheduler,
	const ApuCommandFifo& commandFifo,
	ApuActiveSlots& activeSlots,
	ApuOutputMixer& audioOutput
)
	: m_scheduler(scheduler)
	, m_commandFifo(commandFifo)
	, m_activeSlots(activeSlots)
	, m_audioOutput(audioOutput)
	, m_dma(dma)
	, m_sampleTransfer(memory, sampleMemory, dma, scheduler)
	, m_cpuHz(APU_SAMPLE_RATE_HZ) {
	memory.mapIoWrite(IO_APU_TRANSFER_ADDRESS, this, &ApuServiceClock::writeTransferAddressThunk);
	memory.mapIoRead(IO_APU_TRANSFER_DATA, this, &ApuServiceClock::readTransferDataThunk);
	memory.mapIoWrite(IO_APU_TRANSFER_DATA, this, &ApuServiceClock::writeTransferDataThunk);
	memory.mapIoWriteReady(IO_APU_TRANSFER_DATA, &ApuServiceClock::transferDataWriteReadyThunk);
	memory.mapIoWrite(IO_APU_TRANSFER_CONTROL, this, &ApuServiceClock::writeTransferControlThunk);
}

u32 ApuServiceClock::readTransferDataThunk(void* context, u32, MappedBusSignals busSignals) {
	auto& clock = *static_cast<ApuServiceClock*>(context);
	const i64 nowCycles = clock.m_scheduler.currentNowCycles();
	clock.synchronizeBeforeTransferAccess(nowCycles);
	const u32 word = (busSignals & MAPPED_BUS_MASTER_DMA) != 0u
		? clock.m_sampleTransfer.readDmaData((busSignals & MAPPED_BUS_DMA_BLOCK_END) != 0u)
		: clock.m_sampleTransfer.readCpuData();
	clock.advanceVoicesTo(nowCycles);
	return word;
}

void ApuServiceClock::writeTransferAddressThunk(void* context, u32, u32 value, MappedBusSignals) {
	auto& clock = *static_cast<ApuServiceClock*>(context);
	const i64 nowCycles = clock.m_scheduler.currentNowCycles();
	clock.synchronizeBeforeTransferAccess(nowCycles);
	clock.m_sampleTransfer.writeAddress(value);
	clock.advanceVoicesTo(nowCycles);
}

void ApuServiceClock::writeTransferDataThunk(void* context, u32, u32 value, MappedBusSignals busSignals) {
	auto& clock = *static_cast<ApuServiceClock*>(context);
	const i64 nowCycles = clock.m_scheduler.currentNowCycles();
	clock.synchronizeBeforeTransferAccess(nowCycles);
	if ((busSignals & MAPPED_BUS_MASTER_DMA) != 0u) {
		clock.m_sampleTransfer.writeDmaData(value, (busSignals & MAPPED_BUS_DMA_BLOCK_END) != 0u);
	} else {
		clock.m_sampleTransfer.writeCpuData(value);
	}
	clock.advanceVoicesTo(nowCycles);
}

bool ApuServiceClock::transferDataWriteReadyThunk(void* context, u32, MappedBusSignals busSignals) {
	if ((busSignals & MAPPED_BUS_MASTER_DMA) != 0u) {
		return true;
	}
	auto& clock = *static_cast<ApuServiceClock*>(context);
	return !clock.m_dma.ownsReadPort(IO_APU_TRANSFER_DATA)
		&& !clock.m_dma.ownsWritePort(IO_APU_TRANSFER_DATA);
}

void ApuServiceClock::writeTransferControlThunk(void* context, u32, u32 value, MappedBusSignals) {
	auto& clock = *static_cast<ApuServiceClock*>(context);
	const i64 nowCycles = clock.m_scheduler.currentNowCycles();
	clock.synchronizeBeforeTransferAccess(nowCycles);
	clock.m_sampleTransfer.writeControl(value);
	clock.advanceVoicesTo(nowCycles);
}

void ApuServiceClock::reset(i64 nowCycles) {
	m_sampleTransfer.reset();
	m_sampleCarry = 0;
	m_sampleSequence = 0;
	m_lastCycle = nowCycles;
	m_voiceClockHeld = false;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
}

void ApuServiceClock::dispose() {
	m_sampleTransfer.dispose();
	m_sampleCarry = 0;
	m_sampleSequence = 0;
	m_lastCycle = m_scheduler.currentNowCycles();
	m_voiceClockHeld = false;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
}

i64 ApuServiceClock::captureSampleCarry() const {
	return m_sampleCarry;
}

i64 ApuServiceClock::captureSampleSequence() const {
	return m_sampleSequence;
}

auto ApuServiceClock::captureSampleTransferState(i64 nowCycles) const -> ApuSampleTransferState {
	return m_sampleTransfer.captureState(nowCycles);
}

void ApuServiceClock::restore(
	i64 sampleCarry,
	i64 sampleSequence,
	const ApuSampleTransferState& sampleTransferState,
	i64 nowCycles
) {
	m_sampleCarry = sampleCarry;
	m_sampleSequence = sampleSequence;
	m_lastCycle = nowCycles;
	m_voiceClockHeld = false;
	m_sampleTransfer.restoreState(sampleTransferState, nowCycles);
}

void ApuServiceClock::setVoiceClockHeld(bool held, i64 nowCycles) {
	if (m_voiceClockHeld == held) {
		return;
	}
	synchronize(nowCycles);
	m_voiceClockHeld = held;
	if (held) {
		m_audioOutput.outputRing.clear();
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	} else {
		scheduleNext(nowCycles);
	}
}

void ApuServiceClock::setCpuHz(i64 cpuHz, i64 nowCycles) {
	synchronize(nowCycles);
	m_sampleTransfer.setTiming(cpuHz, nowCycles);
	m_cpuHz = cpuHz;
}

void ApuServiceClock::synchronize(i64 nowCycles) {
	while (m_sampleTransfer.m_scheduledWords != 0u
		&& m_sampleTransfer.m_serviceDeadline <= nowCycles) {
		const i64 transferCycle = m_sampleTransfer.m_serviceDeadline;
		advanceVoicesTo(transferCycle - 1);
		m_sampleTransfer.completeService();
		advanceVoicesTo(transferCycle);
	}
	advanceVoicesTo(nowCycles);
}

void ApuServiceClock::scheduleNext(i64 nowCycles) {
	if (m_voiceClockHeld) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
		return;
	}
	if (!m_commandFifo.empty()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
		return;
	}
	const i64 serviceFrames = m_audioOutput.samplesUntilNextEvent(ApuOutputMixer::MIX_BATCH_FRAMES);
	m_scheduler.scheduleDeviceService(
		DEVICE_SERVICE_APU,
		nowCycles + cyclesUntilBudgetUnits(m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, serviceFrames)
	);
}

auto ApuServiceClock::sampleTransferStatusBits() const -> u32 {
	return m_sampleTransfer.statusBits();
}

void ApuServiceClock::synchronizeBeforeTransferAccess(i64 nowCycles) {
	while (m_sampleTransfer.m_scheduledWords != 0u
		&& m_sampleTransfer.m_serviceDeadline < nowCycles) {
		const i64 transferCycle = m_sampleTransfer.m_serviceDeadline;
		advanceVoicesTo(transferCycle - 1);
		m_sampleTransfer.completeService();
		advanceVoicesTo(transferCycle);
	}
	advanceVoicesTo(nowCycles - 1);
	while (m_sampleTransfer.m_scheduledWords != 0u
		&& m_sampleTransfer.m_serviceDeadline <= nowCycles) {
		m_sampleTransfer.completeService();
	}
}

void ApuServiceClock::advanceVoicesTo(i64 cycle) {
	if (cycle <= m_lastCycle) {
		return;
	}
	const i64 cycles = cycle - m_lastCycle;
	m_lastCycle = cycle;
	if (m_voiceClockHeld) {
		return;
	}
	accrueBudgetUnits(m_budgetAccrual, m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, cycles);
	m_sampleCarry = m_budgetAccrual.carry;
	if (m_budgetAccrual.wholeUnits != 0) {
		m_activeSlots.advance(m_budgetAccrual.wholeUnits, m_sampleSequence);
		m_sampleSequence += m_budgetAccrual.wholeUnits;
	}
}

} // namespace bmsx
