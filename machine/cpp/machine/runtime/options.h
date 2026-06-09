#pragma once

#include "common/primitives.h"
#include "machine/runtime/timing/constants.h"
#include <cstddef>

namespace bmsx {

constexpr int DEFAULT_CYCLE_BUDGET = 1'000'000;

struct MachineManifest;
struct CartManifest;

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	struct RomSpan {
		const u8* data = nullptr;
		size_t size = 0;
	};

	Vec2 viewport{.x=0.0F, .y=0.0F};
	RomSpan systemRomBytes;
	RomSpan cartRomBytes;
	const MachineManifest* machineManifest = nullptr;
	i64 ufpsScaled = DEFAULT_UFPS_SCALED;
	i64 cpuHz = 0;
	int cycleBudgetPerFrame = DEFAULT_CYCLE_BUDGET;
	int vblankCycles = 0;
	int vdpWorkUnitsPerSec = 25'600;
	int geoWorkUnitsPerSec = 16'384'000;
};

} // namespace bmsx
