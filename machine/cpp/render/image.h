#ifndef BMSX_RENDER_IMAGE_H
#define BMSX_RENDER_IMAGE_H

#include "common/types.h"
#include <vector>

namespace bmsx {

// Owned, tightly packed, top-down RGBA8 in display/signal color space.
struct RgbaImage {
	i32 width;
	i32 height;
	std::vector<u8> pixels;
};

} // namespace bmsx
#endif
