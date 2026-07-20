#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;
struct ResolvedRuntimeTiming {
	bool pcrtcRunning;
	i64 ufpsScaled;
	i64 totalHalfLines;
	i64 activeDisplayHalfLines;
	i64 cpuHz;
	int geoWorkUnitsPerSec;
	i64 cycleBudgetPerFrame;
};

ResolvedRuntimeTiming resolveRuntimeTiming(i64 cpuHz);

} // namespace bmsx
