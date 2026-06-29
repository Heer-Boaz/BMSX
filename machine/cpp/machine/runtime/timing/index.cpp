#include "machine/runtime/timing/index.h"

namespace bmsx {

namespace {

i64 floorScaledRatio(i64 value, i64 multiplier, i64 divisor) {
	const i64 whole = (value / divisor) * multiplier;
	const i64 remainder = ((value % divisor) * multiplier) / divisor;
	return whole + remainder;
}

} // namespace

i64 calcCyclesPerFrameScaled(i64 cpuHz, i64 refreshHzScaled) {
	return floorScaledRatio(cpuHz, HZ_SCALE, refreshHzScaled);
}

i64 resolveVblankCycles(i64 cpuFreqHz, i64 ufpsScaled, i64 totalScanlines, i32 renderHeight) {
	const i64 cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const i64 activeDisplayCycles = floorScaledRatio(cycleBudgetPerFrame, renderHeight, totalScanlines);
	return cycleBudgetPerFrame - activeDisplayCycles;
}

} // namespace bmsx
