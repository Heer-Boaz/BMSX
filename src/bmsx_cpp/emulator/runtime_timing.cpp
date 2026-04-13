#include "runtime_timing.h"
#include <stdexcept>

namespace bmsx {

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
	const i64 activeScanlines = cycleBudgetPerFrame / static_cast<i64>(renderHeight + 1);
	const i64 activeDisplayCycles = activeScanlines * static_cast<i64>(renderHeight);
	const i64 vblankCycles = cycleBudgetPerFrame - activeDisplayCycles;
	if (vblankCycles <= 0) {
		throw std::runtime_error("[RuntimeTiming] vblank_cycles must be greater than 0.");
	}
	if (vblankCycles > cycleBudgetPerFrame) {
		throw std::runtime_error("[RuntimeTiming] vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	return vblankCycles;
}

RuntimeTimingState::RuntimeTimingState(i64 ufpsScaledValue) {
	applyUfpsScaled(ufpsScaledValue);
}

void RuntimeTimingState::applyUfpsScaled(i64 value) {
	if (value <= HZ_SCALE) {
		throw std::runtime_error("[RuntimeTiming] machine.ufps must be greater than 1 Hz.");
	}
	ufpsScaled = value;
	ufps = static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE);
	frameDurationMs = 1000.0 / ufps;
}

} // namespace bmsx
