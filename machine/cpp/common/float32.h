#pragma once
#include <cstdint>
#include <cstring>
#include <limits>

namespace bmsx {
static_assert(sizeof(float) == sizeof(uint32_t) && std::numeric_limits<float>::is_iec559
	&& std::numeric_limits<float>::digits == 24, "binary32 datapaths require IEEE single precision");
inline float f32BitsToNumber(uint32_t bits) {
	float value;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}
inline uint32_t numberToF32Bits(float value) {
	uint32_t bits;
	std::memcpy(&bits, &value, sizeof(bits));
	return bits;
}
} // namespace bmsx
