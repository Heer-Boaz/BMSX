#pragma once

#include "common/primitives.h"

namespace bmsx {

// The first five ordinals are the raw ICU pointer-button bit positions.
enum class PointerControl : u8 {
	Primary,
	Aux,
	Secondary,
	Back,
	Forward,
	Position,
	Wheel,
};

} // namespace bmsx
