#pragma once

#include "core/primitives.h"
#include <string>

namespace bmsx {

void readVdpTextureRegion(const std::string& textureKey, u8* out, i32 width, i32 height, i32 x, i32 y);

} // namespace bmsx
