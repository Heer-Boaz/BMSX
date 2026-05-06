#pragma once

#include "common/primitives.h"
#include <cstring>
#include <limits>

namespace bmsx {

constexpr int FIX16_SHIFT = 16;
constexpr i64 FIX16_ONE = i64{1} << FIX16_SHIFT;
constexpr double FIX16_SCALE = 65536.0;

inline i32 toSignedWord(u32 value) {
	return static_cast<i32>(value);
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

inline i32 saturateI32(i64 value) {
	if (value < static_cast<i64>(std::numeric_limits<i32>::min())) {
		return std::numeric_limits<i32>::min();
	}
	if (value > static_cast<i64>(std::numeric_limits<i32>::max())) {
		return std::numeric_limits<i32>::max();
	}
	return static_cast<i32>(value);
}

inline i32 saturateRoundedI32(double value) {
	if (value <= static_cast<double>(std::numeric_limits<i32>::min())) {
		return std::numeric_limits<i32>::min();
	}
	if (value != value) {
		return 0;
	}
	constexpr double maxRoundedInput = static_cast<double>(std::numeric_limits<i32>::max()) - 0.5;
	if (value >= maxRoundedInput) {
		return std::numeric_limits<i32>::max();
	}
	const double rounded = value + 0.5;
	i32 result = static_cast<i32>(rounded);
	if (rounded < 0.0 && static_cast<double>(result) != rounded) {
		result -= 1;
	}
	return result;
}

inline i64 saturatingAdd64(i64 lhs, i64 rhs) {
	if (rhs > 0 && lhs > (std::numeric_limits<i64>::max() - rhs)) {
		return std::numeric_limits<i64>::max();
	}
	if (rhs < 0 && lhs < (std::numeric_limits<i64>::min() - rhs)) {
		return std::numeric_limits<i64>::min();
	}
	return lhs + rhs;
}

inline i32 transformFixed16(i32 m0, i32 m1, i32 tx, i32 x, i32 y) {
	i64 accum = 0;
	accum = saturatingAdd64(accum, static_cast<i64>(m0) * static_cast<i64>(x));
	accum = saturatingAdd64(accum, static_cast<i64>(m1) * static_cast<i64>(y));
	accum = saturatingAdd64(accum, static_cast<i64>(tx) * FIX16_ONE);
	return saturateI32(accum >> FIX16_SHIFT);
}

} // namespace bmsx
