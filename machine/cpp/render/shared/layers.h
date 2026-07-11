#pragma once

#include "common/primitives.h"

namespace bmsx {

enum class Layer2D : u8 {
	World = 0,
	UI = 1,
	IDE = 2,
};

constexpr u32 LAYER_2D_WORLD = 0u;
constexpr u32 LAYER_2D_UI = 1u;
constexpr u32 LAYER_2D_IDE = 2u;

} // namespace bmsx
