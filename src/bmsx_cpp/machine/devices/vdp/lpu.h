#pragma once

#include "common/types.h"
#include <array>
#include <cstddef>

namespace bmsx {

constexpr u32 VDP_LPU_PACKET_KIND = 0x17000000u;

constexpr u32 VDP_LPU_CONTROL_ENABLE = 1u;

// LPU register layout (all words stored as IEEE 754 float bits):
// Ambient block (4 words):  r, g, b, intensity
// Dir light N  (8 words):   dir.x, dir.y, dir.z, pad,  color.r, color.g, color.b, intensity
// Point light N (8 words):  pos.x, pos.y, pos.z, range, color.r, color.g, color.b, intensity
constexpr size_t VDP_LPU_AMBIENT_REGISTER_BASE = 0u;
constexpr size_t VDP_LPU_AMBIENT_REGISTER_WORDS = 4u;
constexpr size_t VDP_LPU_DIRECTIONAL_LIGHT_LIMIT = 4u;
constexpr size_t VDP_LPU_DIRECTIONAL_REGISTER_BASE = VDP_LPU_AMBIENT_REGISTER_BASE + VDP_LPU_AMBIENT_REGISTER_WORDS;
constexpr size_t VDP_LPU_DIRECTIONAL_REGISTER_WORDS = 8u;
constexpr size_t VDP_LPU_POINT_LIGHT_LIMIT = 4u;
constexpr size_t VDP_LPU_POINT_REGISTER_BASE = VDP_LPU_DIRECTIONAL_REGISTER_BASE + VDP_LPU_DIRECTIONAL_LIGHT_LIMIT * VDP_LPU_DIRECTIONAL_REGISTER_WORDS;
constexpr size_t VDP_LPU_POINT_REGISTER_WORDS = 8u;
constexpr size_t VDP_LPU_REGISTER_WORDS = VDP_LPU_POINT_REGISTER_BASE + VDP_LPU_POINT_LIGHT_LIMIT * VDP_LPU_POINT_REGISTER_WORDS;


class VdpLpuUnit {
public:
	std::array<u32, VDP_LPU_REGISTER_WORDS> registerWords{};

	void reset();
};

} // namespace bmsx
