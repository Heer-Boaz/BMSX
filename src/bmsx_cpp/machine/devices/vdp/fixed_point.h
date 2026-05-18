#pragma once

#include "common/primitives.h"
#include <cstddef>

namespace bmsx {

inline f32 decodeSignedQ16_16(u32 value) {
	return static_cast<f32>(static_cast<i32>(value)) / 65536.0f;
}

inline void decodeSignedQ16_16WordsInto(f32* target, const u32* words, size_t count) {
	for (size_t index = 0u; index < count; ++index) {
		target[index] = decodeSignedQ16_16(words[index]);
	}
}

inline u32 encodeSignedQ16_16(f32 value) {
	return static_cast<u32>(static_cast<i32>(value * 65536.0f));
}

inline f32 decodeUnsignedQ16_16(u32 value) {
	return static_cast<f32>(value) / 65536.0f;
}

inline f32 decodeTurn16(u32 value) {
	return static_cast<f32>(value & 0xffffu) * (6.28318530717958647692f / 65536.0f);
}

} // namespace bmsx
