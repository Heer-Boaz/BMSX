#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;
struct ResolvedRuntimeTiming {
	i32 viewportWidth;
	i32 viewportHeight;
	uint32_t gpuDisplayModeWord;
	i64 ufpsScaled;
	i64 totalScanlines;
	i64 cpuHz;
	i64 imgDecBytesPerSec;
	i64 dmaBytesPerSecIso;
	i64 dmaBytesPerSecBulk;
	int vdpWorkUnitsPerSec;
	int geoWorkUnitsPerSec;
	int cycleBudgetPerFrame;
	int vblankCycles;
};

ResolvedRuntimeTiming resolveRuntimeTiming(
	i64 cpuHz,
	uint32_t gpuDisplayModeWord
);
void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing);

} // namespace bmsx
