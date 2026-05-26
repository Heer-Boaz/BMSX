#pragma once

#include "common/vector.h"

namespace bmsx {

inline constexpr i32 TEXTURE_WRAP_CLAMP_TO_EDGE = 0x812f;
inline constexpr i32 TEXTURE_FILTER_NEAREST = 0x2600;

struct TextureParams {
	Vec2 size{.x=0.0F, .y=0.0F};
	i32 wrapS = TEXTURE_WRAP_CLAMP_TO_EDGE;
	i32 wrapT = TEXTURE_WRAP_CLAMP_TO_EDGE;
	i32 minFilter = TEXTURE_FILTER_NEAREST;
	i32 magFilter = TEXTURE_FILTER_NEAREST;
	bool srgb = true;
};

inline const TextureParams RGBA8_SRGB_TEXTURE_PARAMS{.size = {.x = 0.0F, .y = 0.0F}, .wrapS = TEXTURE_WRAP_CLAMP_TO_EDGE, .wrapT = TEXTURE_WRAP_CLAMP_TO_EDGE, .minFilter = TEXTURE_FILTER_NEAREST, .magFilter = TEXTURE_FILTER_NEAREST, .srgb = true};
inline const TextureParams RGBA8_LINEAR_TEXTURE_PARAMS{.size = {.x = 0.0F, .y = 0.0F}, .wrapS = TEXTURE_WRAP_CLAMP_TO_EDGE, .wrapT = TEXTURE_WRAP_CLAMP_TO_EDGE, .minFilter = TEXTURE_FILTER_NEAREST, .magFilter = TEXTURE_FILTER_NEAREST, .srgb = false};

} // namespace bmsx
