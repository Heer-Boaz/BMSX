#pragma once

#include "core/primitives.h"

namespace bmsx {

constexpr i64 HZ_SCALE = 1'000'000;
constexpr f64 DEFAULT_UFPS = 50.0;
constexpr i64 DEFAULT_UFPS_SCALED = static_cast<i64>(DEFAULT_UFPS) * HZ_SCALE;

int calcCyclesPerFrame(i64 cpuHz, i64 refreshHzScaled);
i64 resolveVblankCycles(i64 cpuHz, i64 refreshHzScaled, i32 renderHeight);

struct TimingState {
	explicit TimingState(i64 ufpsScaled = DEFAULT_UFPS_SCALED, i64 cpuHz = 0, int cycleBudgetPerFrame = 0);
	void applyUfpsScaled(i64 value);

	i64 ufpsScaled = DEFAULT_UFPS_SCALED;
	f64 ufps = DEFAULT_UFPS;
	f64 frameDurationMs = 1000.0 / DEFAULT_UFPS;
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = 0;
	int vdpWorkUnitsPerSec = 0;
	int geoWorkUnitsPerSec = 0;
	i64 imgDecBytesPerSec = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
};

} // namespace bmsx
