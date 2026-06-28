#include "machine/devices/audio/service_clock.h"

#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/scheduler/budget.h"
#include "machine/scheduler/device.h"

#include <utility>

namespace bmsx {

ApuServiceClock::ApuServiceClock(DeviceScheduler& scheduler, const ApuCommandFifo& commandFifo, const ApuSlotBank& slots)
	: m_scheduler(scheduler)
	, m_commandFifo(commandFifo)
	, m_slots(slots)
	, m_cpuHz(APU_SAMPLE_RATE_HZ) {}

void ApuServiceClock::reset() {
	m_sampleCarry = 0;
	m_availableSamples = 0;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
}

i64 ApuServiceClock::captureSampleCarry() const {
	return m_sampleCarry;
}

i64 ApuServiceClock::captureAvailableSamples() const {
	return m_availableSamples;
}

void ApuServiceClock::restore(i64 sampleCarry, i64 availableSamples) {
	m_sampleCarry = sampleCarry;
	m_availableSamples = availableSamples;
}

void ApuServiceClock::setCpuHz(i64 cpuHz) {
	m_cpuHz = cpuHz;
}

void ApuServiceClock::clearBudget() {
	m_sampleCarry = 0;
	m_availableSamples = 0;
}

void ApuServiceClock::accrueCycles(int cycles) {
	BudgetAccrual accrual;
	accrueBudgetUnits(accrual, m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, cycles);
	m_availableSamples += accrual.wholeUnits;
	m_sampleCarry = accrual.carry;
}

bool ApuServiceClock::pendingSamples() const {
	return m_availableSamples != 0;
}

i64 ApuServiceClock::consumeSamples() {
	return std::exchange(m_availableSamples, 0);
}

void ApuServiceClock::scheduleNext(i64 nowCycles) {
	if (!m_commandFifo.empty()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
		return;
	}
	if (m_slots.activeMask() == 0u) {
		m_scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
		m_sampleCarry = 0;
		m_availableSamples = 0;
		return;
	}
	if (m_availableSamples > 0) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, 1));
}

} // namespace bmsx
