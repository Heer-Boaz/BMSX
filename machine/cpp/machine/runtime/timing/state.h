#pragma once

#include "common/primitives.h"

namespace bmsx {

struct TimingState {
	TimingState(
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
	);

	i64 ufpsScaled;
	f64 ufps;
	f64 frameDurationMs;
	uint32_t regionWord;
	i64 totalScanlines;
	i64 cpuHz;
	int cycleBudgetPerFrame;
	int vdpWorkUnitsPerSec;
	int geoWorkUnitsPerSec;
	i64 imgDecBytesPerSec;
	i64 dmaBytesPerSecIso;
	i64 dmaBytesPerSecBulk;
};

} // namespace bmsx
