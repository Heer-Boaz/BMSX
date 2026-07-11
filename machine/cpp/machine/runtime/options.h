#pragma once

#include "common/primitives.h"
#include <cstddef>

namespace bmsx {

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	struct RomSpan {
		const u8* data;
		size_t size;
	};

	RomSpan systemRomBytes;
	RomSpan cartRomBytes;
	uint32_t psxGpuDisplayModeWord;
	i64 ufpsScaled;
	i64 cpuHz;
	int cycleBudgetPerFrame;
	int vblankCycles;
	i64 dmaBytesPerSec;
	int geoWorkUnitsPerSec;
};

} // namespace bmsx
