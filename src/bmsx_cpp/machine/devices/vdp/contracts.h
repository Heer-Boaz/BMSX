#pragma once

#include "core/primitives.h"
#include <cstddef>

namespace bmsx {

enum class Layer2D : u8 {
	World = 0,
	UI = 1,
	IDE = 2,
};

struct VdpSlotSource {
	u32 slot = 0;
	u32 u = 0;
	u32 v = 0;
	u32 w = 0;
	u32 h = 0;
};

struct SkyboxFaceSources {
	VdpSlotSource posx;
	VdpSlotSource negx;
	VdpSlotSource posy;
	VdpSlotSource negy;
	VdpSlotSource posz;
	VdpSlotSource negz;
};

struct VdpParallaxRig {
	f32 vy = 0.0f;
	f32 scale = 1.0f;
	f32 impact = 0.0f;
	f32 impact_t = 0.0f;
	f32 bias_px = 0.0f;
	f32 parallax_strength = 1.0f;
	f32 scale_strength = 1.0f;
	f32 flip_strength = 0.0f;
	f32 flip_window = 0.6f;
};

constexpr size_t SKYBOX_FACE_COUNT = 6;

} // namespace bmsx
