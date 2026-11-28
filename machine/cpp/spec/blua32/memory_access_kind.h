#pragma once

#include <array>
#include <cstdint>

namespace bmsx {

enum class MemoryAccessKind : uint8_t {
	Word = 0,
	U8 = 1,
	U16LE = 2,
	U32LE = 3,
	F32LE = 4,
	F64LE = 5,
	Value = 6, // Tagged RAM transfer.
	ContextWord = 7,
};

// A memory Value carries a little-endian payload and a tag byte.
inline constexpr uint32_t VALUE_MEMORY_SIZE = 8u;
inline constexpr uint32_t VALUE_MEMORY_TAG_OFFSET = 4u;

inline constexpr int F64_ACCESS_EXTRA_CYCLES = 2;

inline constexpr std::array<uint32_t, 8> MEMORY_ACCESS_KIND_BYTE_SIZES{4u, 1u, 2u, 4u, 4u, 8u, VALUE_MEMORY_SIZE, 4u};

inline constexpr std::array<uint32_t, 8> MEMORY_ACCESS_KIND_ALIGNMENT_MASKS{
	3u,
	0u,
	1u,
	3u,
	3u,
	3u,
	3u,
	0u,
};

} // namespace bmsx
