#pragma once

#include "common/primitives.h"

namespace bmsx {

class ApuCommandFifo;
class ApuSlotBank;
class DeviceScheduler;

class ApuServiceClock final {
public:
	ApuServiceClock(DeviceScheduler& scheduler, const ApuCommandFifo& commandFifo, const ApuSlotBank& slots);

	void reset();
	i64 captureSampleCarry() const;
	i64 captureAvailableSamples() const;
	void restore(i64 sampleCarry, i64 availableSamples);
	void setCpuHz(i64 cpuHz);
	void clearBudget();
	void accrueCycles(int cycles);
	bool pendingSamples() const;
	i64 consumeSamples();
	void scheduleNext(i64 nowCycles);

private:
	DeviceScheduler& m_scheduler;
	const ApuCommandFifo& m_commandFifo;
	const ApuSlotBank& m_slots;
	i64 m_cpuHz;
	i64 m_sampleCarry = 0;
	i64 m_availableSamples = 0;
};

} // namespace bmsx
