#pragma once

#include "common/types.h"

#include <array>
#include <optional>
#include <string_view>

namespace bmsx {

enum class MemoryAccessKind : u8 {
	Word = 0,
	U8 = 1,
	U16LE = 2,
	U32LE = 3,
	F32LE = 4,
	F64LE = 5,
};

inline constexpr std::array<std::string_view, 6> MEMORY_ACCESS_KIND_NAMES{
	"mem",
	"mem8",
	"mem16le",
	"mem32le",
	"memf32le",
	"memf64le",
};

std::optional<MemoryAccessKind> getMemoryAccessKindForName(std::string_view name);

} // namespace bmsx
