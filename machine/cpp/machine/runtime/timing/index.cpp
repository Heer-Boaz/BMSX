#include "machine/runtime/timing/index.h"

namespace bmsx {

i64 calcCyclesPerFrameScaled(i64 cpuHz, i64 refreshHzScaled) {
	const i64 whole = (cpuHz / refreshHzScaled) * HZ_SCALE;
	const i64 remainder = ((cpuHz % refreshHzScaled) * HZ_SCALE) / refreshHzScaled;
	return whole + remainder;
}

i64 resolveVblankCycles(i64 cpuFreqHz, i64 ufpsScaled, i64 totalScanlines, i32 renderHeight) {
	const i64 cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const i64 whole = (cycleBudgetPerFrame / totalScanlines) * renderHeight;
	const i64 remainder = ((cycleBudgetPerFrame % totalScanlines) * renderHeight) / totalScanlines;
	return cycleBudgetPerFrame - (whole + remainder);
}

} // namespace bmsx
