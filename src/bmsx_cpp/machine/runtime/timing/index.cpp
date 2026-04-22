#include "machine/runtime/timing/index.h"
#include <stdexcept>

namespace bmsx {

namespace {

constexpr i64 PAL_TOTAL_SCANLINES = 313;
constexpr i64 NTSC_TOTAL_SCANLINES = 262;
constexpr i64 PAL_NTSC_REFRESH_CUTOFF_SCALED = 55 * HZ_SCALE;

i64 resolveTotalScanlines(i64 refreshHzScaled) {
	return refreshHzScaled <= PAL_NTSC_REFRESH_CUTOFF_SCALED ? PAL_TOTAL_SCANLINES : NTSC_TOTAL_SCANLINES;
}

} // namespace

int calcCyclesPerFrame(i64 cpuHz, i64 refreshHzScaled) {
	if (cpuHz <= 0) {
		throw std::runtime_error("[RuntimeTiming] cpuHz must be a positive integer.");
	}
	if (refreshHzScaled <= HZ_SCALE) {
		throw std::runtime_error("[RuntimeTiming] refreshHzScaled must be greater than 1 Hz.");
	}
	const i64 wholeCycles = (cpuHz / refreshHzScaled) * HZ_SCALE;
	const i64 remainderCycles = ((cpuHz % refreshHzScaled) * HZ_SCALE) / refreshHzScaled;
	const i64 cyclesPerFrame = wholeCycles + remainderCycles;
	if (cyclesPerFrame <= 0) {
		throw std::runtime_error("[RuntimeTiming] cycles per frame must be a positive integer.");
	}
	return static_cast<int>(cyclesPerFrame);
}

i64 resolveVblankCycles(i64 cpuHz, i64 refreshHzScaled, i32 renderHeight) {
	if (renderHeight <= 0) {
		throw std::runtime_error("[RuntimeTiming] renderHeight must be a positive integer.");
	}
	const i64 cycleBudgetPerFrame = calcCyclesPerFrame(cpuHz, refreshHzScaled);
	const i64 totalScanlines = resolveTotalScanlines(refreshHzScaled);
	if (renderHeight >= totalScanlines) {
		throw std::runtime_error("[RuntimeTiming] renderHeight must be smaller than total scanlines.");
	}
	// BMSX derives VBLANK from a simplified CRT scanline model instead of a manifest override.
	// 50 Hz class machines are treated as PAL-like 313-line frames, and faster refresh rates as
	// NTSC-like 262-line frames. This came from checking that the old renderHeight + 1 formula gave
	// Pietious at 5 MHz/50 Hz only 544 VBLANK cycles, effectively a one-scanline frame edge. The
	// scanline ratio gives floor(100000 * 192 / 313) visible cycles and 38659 VBLANK cycles, which
	// keeps the cart refresh at 50/60 Hz while allowing MSX/Konami-style 25/30 Hz game ticks in cart code.
	const i64 activeDisplayCycles =
		(cycleBudgetPerFrame / totalScanlines) * static_cast<i64>(renderHeight)
		+ ((cycleBudgetPerFrame % totalScanlines) * static_cast<i64>(renderHeight)) / totalScanlines;
	const i64 vblankCycles = cycleBudgetPerFrame - activeDisplayCycles;
	if (vblankCycles <= 0) {
		throw std::runtime_error("[RuntimeTiming] vblank_cycles must be greater than 0.");
	}
	if (vblankCycles > cycleBudgetPerFrame) {
		throw std::runtime_error("[RuntimeTiming] vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	return vblankCycles;
}

TimingState::TimingState(i64 ufpsScaledValue, i64 cpuHzValue, int cycleBudgetPerFrameValue)
	: cpuHz(cpuHzValue)
	, cycleBudgetPerFrame(cycleBudgetPerFrameValue) {
	applyUfpsScaled(ufpsScaledValue);
}

void TimingState::applyUfpsScaled(i64 value) {
	if (value <= HZ_SCALE) {
		throw std::runtime_error("[RuntimeTiming] machine.ufps must be greater than 1 Hz.");
	}
	ufpsScaled = value;
	ufps = static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE);
	frameDurationMs = 1000.0 / ufps;
}

} // namespace bmsx
