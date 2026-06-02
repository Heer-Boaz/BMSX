#include "machine/runtime/timing/state.h"

#include <stdexcept>

namespace bmsx {

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
