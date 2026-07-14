#include "machine/runtime/timing/state.h"

#include "machine/runtime/timing/constants.h"

namespace bmsx {

TimingState::TimingState(
	i64 ufpsScaled,
	i64 cpuHz,
	int cycleBudgetPerFrame,
	uint32_t gpuDisplayModeWord,
	uint32_t gpuVerticalDisplayRangeWord,
	i64 totalScanlines,
	i64 dmaWordsPerSec,
	int geoWorkUnitsPerSec
)
	: ufpsScaled(ufpsScaled)
	, ufps(static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE))
	, frameDurationMs(1000.0 / ufps)
	, gpuDisplayModeWord(gpuDisplayModeWord)
	, gpuVerticalDisplayRangeWord(gpuVerticalDisplayRangeWord)
	, totalScanlines(totalScanlines)
	, cpuHz(cpuHz)
	, cycleBudgetPerFrame(cycleBudgetPerFrame)
	, geoWorkUnitsPerSec(geoWorkUnitsPerSec)
	, dmaWordsPerSec(dmaWordsPerSec) {
}

} // namespace bmsx
