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
	Value = 6, // Fixed System activation only.
};

inline constexpr int F64_ACCESS_EXTRA_CYCLES = 2;

inline constexpr std::array<uint32_t, 7> MEMORY_ACCESS_KIND_ALIGNMENT_MASKS{
	3u,
	0u,
	1u,
	3u,
	3u,
	3u,
	3u,
};

} // namespace bmsx
