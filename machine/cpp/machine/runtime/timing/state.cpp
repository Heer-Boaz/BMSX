#include "machine/runtime/timing/state.h"

namespace bmsx {

TimingState::TimingState(i64 ufpsScaled, i64 cpuHz, int cycleBudgetPerFrame)
	: ufpsScaled(ufpsScaled)
	, ufps(static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE))
	, frameDurationMs(1000.0 / ufps)
	, cpuHz(cpuHz)
	, cycleBudgetPerFrame(cycleBudgetPerFrame) {
}

} // namespace bmsx
