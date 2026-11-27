#pragma once

#include <array>
#include <cstdint>
#include <string_view>

namespace bmsx {

// Published slots in the system executable's BLua32 function table.
enum class BiosFunction : uint32_t {
	TurnPhaseSine = 0,
	DecodeFloat = 1,
	SystemVramRegion = 2,
};

enum class BiosCall : uint32_t {
	CreateTable = 0,
	CollectStep = 1,
	Count,
};

inline constexpr int BIOS_CALL_CONTEXT_WORDS = 3;
inline constexpr std::array<int, static_cast<uint32_t>(BiosCall::Count)> BIOS_CALL_ARITY{2, 0};

inline constexpr std::array<std::string_view, 3> BIOS_FUNCTION_MODULE_PATHS = {
	"math/sin",
	"string/float/decode",
	"gpu/system_vram_region",
};

} // namespace bmsx
