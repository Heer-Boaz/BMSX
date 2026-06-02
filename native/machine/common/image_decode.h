#pragma once

#include "common/types.h"
#include <cstddef>
#include <vector>

namespace bmsx {

struct DecodedImage {
	std::vector<u8> pixels;
	u32 width = 0;
	u32 height = 0;
};

DecodedImage decodePngToRgba(const u8* data, size_t size);

} // namespace bmsx
