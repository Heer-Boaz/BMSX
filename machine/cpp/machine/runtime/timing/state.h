#pragma once

#include "common/primitives.h"

namespace bmsx {

struct TimingState {
	TimingState(
		bool pcrtcRunning,
		i64 ufpsScaled,
		i64 cpuHz,
		i64 cycleBudgetPerFrame,
		i64 totalHalfLines,
		i64 activeDisplayHalfLines,
		i64 dmaWordsPerSec,
		i64 dmaRamRowReopenCycles,
		i64 dmaRomWaitCyclesPerWord,
		int geoWorkUnitsPerSec
	);

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
	int geoWorkUnitsPerSec;
	i64 dmaWordsPerSec;
	i64 dmaRamRowReopenCycles;
	i64 dmaRomWaitCyclesPerWord;
};

} // namespace bmsx
