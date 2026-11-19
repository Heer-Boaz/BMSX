#pragma once

#include <cstdint>
#include <string_view>

namespace bmsx {
inline uint32_t fnv1a32(std::string_view bytes) {
	uint32_t hash = 2166136261u;
	for (unsigned char byte : bytes) hash = (hash ^ byte) * 16777619u;
	return hash;
}
} // namespace bmsx
