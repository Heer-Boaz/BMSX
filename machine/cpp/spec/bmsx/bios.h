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

inline constexpr std::array<std::string_view, 3> BIOS_FUNCTION_MODULE_PATHS = {
	"math/sin",
	"string/float/decode",
	"gpu/system_vram_region",
};

} // namespace bmsx
