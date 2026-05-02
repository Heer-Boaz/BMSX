#pragma once

#include "core/primitives.h"

namespace bmsx {

inline f32 decodeSignedQ16_16(u32 value) {
	return static_cast<f32>(static_cast<i32>(value)) / 65536.0f;
}

} // namespace bmsx
