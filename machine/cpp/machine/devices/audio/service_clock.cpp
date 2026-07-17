#include "machine/devices/audio/service_clock.h"

#include "machine/devices/audio/active_slots.h"
#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/output.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuServiceClock::ApuServiceClock(
	DeviceScheduler& scheduler,
	const ApuCommandFifo& commandFifo,
	ApuActiveSlots& activeSlots,
	const ApuOutputMixer& audioOutput
)
	: m_scheduler(scheduler)
	, m_commandFifo(commandFifo)
	, m_activeSlots(activeSlots)
	, m_audioOutput(audioOutput)
	, m_cpuHz(APU_SAMPLE_RATE_HZ) {}

void ApuServiceClock::reset(i64 nowCycles) {
	m_sampleCarry = 0;
	m_lastCycle = nowCycles;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
}

i64 ApuServiceClock::captureSampleCarry() const {
	return m_sampleCarry;
}

void ApuServiceClock::restore(i64 sampleCarry, i64 nowCycles) {
	m_sampleCarry = sampleCarry;
	m_lastCycle = nowCycles;
}

void ApuServiceClock::setCpuHz(i64 cpuHz, i64 nowCycles) {
	synchronize(nowCycles);
	m_cpuHz = cpuHz;
}

void ApuServiceClock::synchronize(i64 nowCycles) {
	const i64 cycles = nowCycles - m_lastCycle;
	m_lastCycle = nowCycles;
	accrueBudgetUnits(m_budgetAccrual, m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, cycles);
	m_sampleCarry = m_budgetAccrual.carry;
	if (m_budgetAccrual.wholeUnits != 0) {
		m_activeSlots.advance(m_budgetAccrual.wholeUnits);
	}
}

void ApuServiceClock::scheduleNext(i64 nowCycles) {
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

} // namespace bmsx
