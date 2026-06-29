#include "machine/runtime/timing/state.h"

#include "machine/runtime/timing/constants.h"

namespace bmsx {

TimingState::TimingState(
	i64 ufpsScaled,
	i64 cpuHz,
	int cycleBudgetPerFrame,
	uint32_t regionWord,
	i64 totalScanlines,
	i64 imgDecBytesPerSec,
	i64 dmaBytesPerSecIso,
	i64 dmaBytesPerSecBulk,
	int vdpWorkUnitsPerSec,
	int geoWorkUnitsPerSec
)
	: ufpsScaled(ufpsScaled)
	, ufps(static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE))
	, frameDurationMs(1000.0 / ufps)
	, regionWord(regionWord)
	, totalScanlines(totalScanlines)
	, cpuHz(cpuHz)
	, cycleBudgetPerFrame(cycleBudgetPerFrame)
	, vdpWorkUnitsPerSec(vdpWorkUnitsPerSec)
	, geoWorkUnitsPerSec(geoWorkUnitsPerSec)
	, imgDecBytesPerSec(imgDecBytesPerSec)
	, dmaBytesPerSecIso(dmaBytesPerSecIso)
	, dmaBytesPerSecBulk(dmaBytesPerSecBulk) {
}

} // namespace bmsx
