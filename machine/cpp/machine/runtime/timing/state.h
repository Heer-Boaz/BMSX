#pragma once

#include "common/primitives.h"

namespace bmsx {

struct MachineModelSpec;

struct TimingState {
	explicit TimingState(const MachineModelSpec& model);

	i64 ufpsScaled;
	f64 ufps;
	f64 frameDurationMs;
	u32 pcrtcRevision = 0u;
	bool pcrtcRunning;
	i64 totalHalfLines;
	i64 activeDisplayHalfLines;
	i64 cpuHz;
	f64 cpuCyclesPerMillisecond;
	i64 cycleBudgetPerFrame;
	i64 geoWorkUnitsPerSec;
};

} // namespace bmsx
