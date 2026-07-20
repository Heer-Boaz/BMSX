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
	bool pcrtcRunning;
	i64 ufpsScaled;
	i64 cpuHz;
	i64 cycleBudgetPerFrame;
	i64 totalHalfLines;
	i64 activeDisplayHalfLines;
	i64 dmaWordsPerSec;
	i64 dmaRamRowReopenCycles;
	i64 dmaRomWaitCyclesPerWord;
	int geoWorkUnitsPerSec;
};

} // namespace bmsx
