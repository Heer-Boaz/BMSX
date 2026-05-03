#pragma once

#include "core/primitives.h"
#include <cstring>

namespace bmsx {

constexpr double FIX16_SCALE = 65536.0;

inline u32 toSignedWord(double value) {
	return static_cast<u32>(static_cast<i32>(value));
}

inline f32 f32BitsToNumber(u32 bits) {
	f32 value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

inline u32 numberToF32Bits(f32 value) {
	u32 bits = 0u;
	std::memcpy(&bits, &value, sizeof(bits));
	return bits;
}

} // namespace bmsx
