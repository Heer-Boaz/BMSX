#pragma once

#include "core/primitives.h"

namespace bmsx {

constexpr double FIX16_SCALE = 65536.0;

inline u32 toSignedWord(double value) {
	return static_cast<u32>(static_cast<i32>(value));
}

} // namespace bmsx
