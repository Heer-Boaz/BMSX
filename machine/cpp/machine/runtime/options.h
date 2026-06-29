#pragma once

#include "common/primitives.h"
#include <cstddef>

namespace bmsx {

struct MachineManifest;
struct CartManifest;

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	struct RomSpan {
		const u8* data;
		size_t size;
	};

	Vec2 viewport;
	RomSpan systemRomBytes;
	RomSpan cartRomBytes;
	const MachineManifest* machineManifest;
	uint32_t machineRegionWord;
	i64 ufpsScaled;
	i64 cpuHz;
	int cycleBudgetPerFrame;
	int vblankCycles;
	i64 imgDecBytesPerSec;
	i64 dmaBytesPerSecIso;
	i64 dmaBytesPerSecBulk;
	int vdpWorkUnitsPerSec;
	int geoWorkUnitsPerSec;
};

} // namespace bmsx
