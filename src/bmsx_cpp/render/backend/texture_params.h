#pragma once

#include "common/vector.h"

namespace bmsx {

inline constexpr i32 TEXTURE_WRAP_CLAMP_TO_EDGE = 0x812f;
inline constexpr i32 TEXTURE_FILTER_NEAREST = 0x2600;

struct TextureParams {
	Vec2 size{0.0f, 0.0f};
	i32 wrapS = TEXTURE_WRAP_CLAMP_TO_EDGE;
	i32 wrapT = TEXTURE_WRAP_CLAMP_TO_EDGE;
	i32 minFilter = TEXTURE_FILTER_NEAREST;
	i32 magFilter = TEXTURE_FILTER_NEAREST;
	bool srgb = true;
};

inline const TextureParams DEFAULT_TEXTURE_PARAMS{.size = {.x = 0.0f, .y = 0.0f}, .wrapS = TEXTURE_WRAP_CLAMP_TO_EDGE, .wrapT = TEXTURE_WRAP_CLAMP_TO_EDGE, .minFilter = TEXTURE_FILTER_NEAREST, .magFilter = TEXTURE_FILTER_NEAREST, .srgb = true};

} // namespace bmsx
