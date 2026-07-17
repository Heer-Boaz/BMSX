#pragma once

#include "common/primitives.h"
#include "machine/scheduler/budget.h"

namespace bmsx {

class ApuActiveSlots;
class ApuCommandFifo;
class ApuOutputMixer;
class DeviceScheduler;

class ApuServiceClock final {
public:
	ApuServiceClock(
		DeviceScheduler& scheduler,
		const ApuCommandFifo& commandFifo,
		ApuActiveSlots& activeSlots,
		const ApuOutputMixer& audioOutput
	);

	void reset(i64 nowCycles);
	i64 captureSampleCarry() const;
	i64 captureSampleSequence() const;
	void restore(i64 sampleCarry, i64 sampleSequence, i64 nowCycles);
	void setCpuHz(i64 cpuHz, i64 nowCycles);
	void synchronize(i64 nowCycles);
	void scheduleNext(i64 nowCycles);

private:
	DeviceScheduler& m_scheduler;
	const ApuCommandFifo& m_commandFifo;
	ApuActiveSlots& m_activeSlots;
	const ApuOutputMixer& m_audioOutput;
	i64 m_cpuHz;
	i64 m_sampleCarry = 0;
	i64 m_sampleSequence = 0;
	i64 m_lastCycle = 0;
	BudgetAccrual m_budgetAccrual{};
};

} // namespace bmsx
