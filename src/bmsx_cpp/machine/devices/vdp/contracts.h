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

constexpr size_t SKYBOX_FACE_COUNT = 6;

} // namespace bmsx
