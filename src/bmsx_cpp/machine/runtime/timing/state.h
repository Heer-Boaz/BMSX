#pragma once

#include "machine/runtime/timing/constants.h"

namespace bmsx {

struct TimingState {
	explicit TimingState(i64 ufpsScaled = DEFAULT_UFPS_SCALED, i64 cpuHz = 0, int cycleBudgetPerFrame = 0);
	void applyUfpsScaled(i64 value);

	i64 ufpsScaled = DEFAULT_UFPS_SCALED;
	f64 ufps = DEFAULT_UFPS;
	f64 frameDurationMs = DEFAULT_FRAME_TIME_MS;
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = 0;
	int vdpWorkUnitsPerSec = 0;
	int geoWorkUnitsPerSec = 0;
	i64 imgDecBytesPerSec = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
};

} // namespace bmsx
