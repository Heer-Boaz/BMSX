#pragma once

#include "common/primitives.h"

namespace bmsx {

enum class Host2DKind : u8 {
	Img,
	Poly,
	Rect,
	Glyphs,
};

using Host2DRef = const void*;

} // namespace bmsx
