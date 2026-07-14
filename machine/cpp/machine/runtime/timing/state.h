#pragma once

#include "common/primitives.h"

namespace bmsx {

struct TimingState {
	TimingState(
		i64 ufpsScaled,
		i64 cpuHz,
		int cycleBudgetPerFrame,
		uint32_t gpuDisplayModeWord,
		uint32_t gpuVerticalDisplayRangeWord,
		i64 totalScanlines,
		i64 dmaWordsPerSec,
		int geoWorkUnitsPerSec
	);

	i64 ufpsScaled;
	f64 ufps;
	f64 frameDurationMs;
	uint32_t gpuDisplayModeWord;
	uint32_t gpuVerticalDisplayRangeWord;
	i64 totalScanlines;
	i64 cpuHz;
	int cycleBudgetPerFrame;
	int geoWorkUnitsPerSec;
	i64 dmaWordsPerSec;
};

} // namespace bmsx
