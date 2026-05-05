#pragma once

#include "common/primitives.h"

namespace bmsx {

inline u32 packedLow16(u32 word) {
	return word & 0xffffu;
}

inline u32 packedHigh16(u32 word) {
	return (word >> 16u) & 0xffffu;
}

inline u32 packLowHigh16(u32 low, u32 high) {
	return (low & 0xffffu) | ((high & 0xffffu) << 16u);
}

} // namespace bmsx
