#pragma once
#include <cstdint>
#include <cstring>

namespace bmsx {

inline int32_t numberHighWord(double value) {
	uint64_t bits;
	std::memcpy(&bits, &value, sizeof(bits));
	return static_cast<int32_t>(bits >> 32);
}

inline uint32_t numberLowWord(double value) {
	uint64_t bits;
	std::memcpy(&bits, &value, sizeof(bits));
	return static_cast<uint32_t>(bits);
}

inline double numberWithHighWord(double value, int32_t high) {
	uint64_t bits;
	std::memcpy(&bits, &value, sizeof(bits));
	bits = (bits & 0xffffffffu) | (static_cast<uint64_t>(static_cast<uint32_t>(high)) << 32);
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

inline double numberWithLowWord(double value, uint32_t low) {
	uint64_t bits;
	std::memcpy(&bits, &value, sizeof(bits));
	bits = (bits & 0xffffffff00000000ull) | low;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

} // namespace bmsx
