#pragma once

#include "core/primitives.h"

namespace bmsx {

class Runtime;
struct MachineManifest;

struct ResolvedRuntimeTiming {
	i32 viewportWidth = 0;
	i32 viewportHeight = 0;
	i64 ufpsScaled = 0;
	i64 cpuHz = 0;
	i64 imgDecBytesPerSec = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	int vdpWorkUnitsPerSec = 0;
	int geoWorkUnitsPerSec = 0;
	int cycleBudgetPerFrame = 0;
	int vblankCycles = 0;
};

ResolvedRuntimeTiming resolveRuntimeTiming(const MachineManifest& machine);
ResolvedRuntimeTiming resolveRuntimeTiming(
	const MachineManifest& viewportMachine,
	const MachineManifest& timingMachine,
	i64 cpuHz,
	i64 ufpsScaled
);
void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing);

} // namespace bmsx
