#include "machine/runtime/timing/index.h"

namespace bmsx {

namespace {

constexpr i64 PAL_TOTAL_SCANLINES = 313;
constexpr i64 NTSC_TOTAL_SCANLINES = 262;
constexpr i64 PAL_NTSC_REFRESH_CUTOFF_SCALED = 55 * HZ_SCALE;

i64 floorScaledRatio(i64 value, i64 multiplier, i64 divisor) {
	const i64 whole = (value / divisor) * multiplier;
	const i64 remainder = ((value % divisor) * multiplier) / divisor;
	return whole + remainder;
}

} // namespace

i64 calcCyclesPerFrameScaled(i64 cpuHz, i64 refreshHzScaled) {
	return floorScaledRatio(cpuHz, HZ_SCALE, refreshHzScaled);
}

i64 resolveTotalScanlines(i64 refreshHzScaled) {
	return refreshHzScaled <= PAL_NTSC_REFRESH_CUTOFF_SCALED ? PAL_TOTAL_SCANLINES : NTSC_TOTAL_SCANLINES;
}

i64 resolveVblankCycles(i64 cpuFreqHz, i64 ufpsScaled, i32 renderHeight) {
	const i64 cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const i64 totalScanlines = resolveTotalScanlines(ufpsScaled);
	// BMSX derives VBLANK from a simplified CRT scanline model instead of a manifest override.
	// 50 Hz class machines are treated as PAL-like 313-line frames, and faster refresh rates as
	// NTSC-like 262-line frames. This came from checking that the old renderHeight + 1 formula gave
	// Pietious at 5 MHz/50 Hz only 544 VBLANK cycles, effectively a one-scanline frame edge. The
	// scanline ratio gives floor(100000 * 192 / 313) visible cycles and 38659 VBLANK cycles, which
	// keeps the cart refresh at 50/60 Hz while allowing MSX/Konami-style 25/30 Hz game ticks in cart code.
	const i64 activeDisplayCycles = floorScaledRatio(cycleBudgetPerFrame, renderHeight, totalScanlines);
	return cycleBudgetPerFrame - activeDisplayCycles;
}

} // namespace bmsx
