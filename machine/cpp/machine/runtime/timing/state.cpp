#include "machine/runtime/timing/state.h"

#include "machine/runtime/timing/constants.h"

namespace bmsx {

TimingState::TimingState(
	bool pcrtcRunning,
	i64 ufpsScaled,
	i64 cpuHz,
	i64 cycleBudgetPerFrame,
	i64 totalHalfLines,
	i64 activeDisplayHalfLines,
	i64 dmaWordsPerSec,
	int geoWorkUnitsPerSec
)
	: ufpsScaled(ufpsScaled)
	, ufps(static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE))
	, frameDurationMs(1000.0 / ufps)
	, pcrtcRunning(pcrtcRunning)
	, totalHalfLines(totalHalfLines)
	, activeDisplayHalfLines(activeDisplayHalfLines)
	, cpuHz(cpuHz)
	, cpuCyclesPerMillisecond(static_cast<f64>(cpuHz) / 1000.0)
	, cycleBudgetPerFrame(cycleBudgetPerFrame)
	, geoWorkUnitsPerSec(geoWorkUnitsPerSec)
	, dmaWordsPerSec(dmaWordsPerSec) {
}

} // namespace bmsx
