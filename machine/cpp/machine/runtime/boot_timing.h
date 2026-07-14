#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;
struct ResolvedRuntimeTiming {
	uint32_t gpuDisplayModeWord;
	i64 ufpsScaled;
	i64 totalScanlines;
	i64 cpuHz;
	i64 dmaWordsPerSec;
	int geoWorkUnitsPerSec;
	int cycleBudgetPerFrame;
	int vblankCycles;
};

ResolvedRuntimeTiming resolveRuntimeTiming(
	i64 cpuHz,
	uint32_t gpuDisplayModeWord
);
void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing);

} // namespace bmsx
