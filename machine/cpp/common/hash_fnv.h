#pragma once

#include <cstdint>
#include <string_view>

namespace bmsx {
inline constexpr uint32_t FNV1A32_PRIME = 16777619u;
inline uint32_t fnv1a32(std::string_view bytes, uint32_t hash = 2166136261u) {
	for (unsigned char byte : bytes) hash = (hash ^ byte) * FNV1A32_PRIME;
	return hash;
}
} // namespace bmsx
