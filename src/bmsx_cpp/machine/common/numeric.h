#pragma once

#include "common/primitives.h"
#include <cstddef>
#include <cstring>
#include <limits>

namespace bmsx {

constexpr int FIX16_SHIFT = 16;
constexpr i64 FIX16_ONE = i64{1} << FIX16_SHIFT;
constexpr double FIX16_SCALE = 65536.0;

inline auto toSignedWord(u32 value) -> i32 {
	return static_cast<i32>(value);
}

inline auto encodeSignedFix16(f32 value) -> u32 {
	return static_cast<u32>(static_cast<i32>(value * static_cast<f32>(FIX16_SCALE)));
}

inline auto decodeSignedFix16(u32 value) -> f32 {
	return static_cast<f32>(toSignedWord(value)) / static_cast<f32>(FIX16_SCALE);
}

inline auto nextPowerOfTwo(size_t value) -> size_t {
	if (value == 0) {
		return 0;
	}
	size_t power = 1;
	while (power < value) {
		power <<= 1;
	}
	return power;
}

inline auto ceilLog2(size_t value) -> size_t {
	size_t log = 0;
	size_t power = 1;
	while (power < value) {
		power <<= 1;
		++log;
	}
	return log;
}

inline auto ceilDiv4(int value) -> int {
	return (value + 3) >> 2;
}

inline auto f32BitsToNumber(u32 bits) -> f32 {
	f32 value = 0.0F;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

inline auto numberToF32Bits(f32 value) -> u32 {
	u32 bits = 0U;
	std::memcpy(&bits, &value, sizeof(bits));
	return bits;
}

inline auto saturateI32(i64 value) -> i32 {
	if (value < static_cast<i64>(std::numeric_limits<i32>::min())) {
		return std::numeric_limits<i32>::min();
	}
	if (value > static_cast<i64>(std::numeric_limits<i32>::max())) {
		return std::numeric_limits<i32>::max();
	}
	return static_cast<i32>(value);
}

inline auto saturateRoundedI32(double value) -> i32 {
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

inline auto saturatingAdd64(i64 lhs, i64 rhs) -> i64 {
	if (rhs > 0 && lhs > (std::numeric_limits<i64>::max() - rhs)) {
		return std::numeric_limits<i64>::max();
	}
	if (rhs < 0 && lhs < (std::numeric_limits<i64>::min() - rhs)) {
		return std::numeric_limits<i64>::min();
	}
	return lhs + rhs;
}

inline auto transformFixed16(i32 m0, i32 m1, i32 tx, i32 x, i32 y) -> i32 {
	i64 accum = 0;
	accum = saturatingAdd64(accum, static_cast<i64>(m0) * static_cast<i64>(x));
	accum = saturatingAdd64(accum, static_cast<i64>(m1) * static_cast<i64>(y));
	accum = saturatingAdd64(accum, static_cast<i64>(tx) * FIX16_ONE);
	return saturateI32(accum >> FIX16_SHIFT);
}

} // namespace bmsx
