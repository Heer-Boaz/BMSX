#pragma once

#include "common/primitives.h"

namespace bmsx {

// Counts raw memory-bus words by the region actually selected by the decoder.
struct MemoryWordCounters {
	u32 ramWords = 0u;
	u32 systemRomWords = 0u;
	u32 cartridgeWords = 0u;
	u32 otherWords = 0u;
};

} // namespace bmsx
