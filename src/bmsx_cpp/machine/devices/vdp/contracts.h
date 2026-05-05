#pragma once

#include "common/primitives.h"
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

struct VdpPmuBank {
	u32 xQ16 = 0u;
	u32 yQ16 = 0u;
	u32 scaleXQ16 = 0x00010000u;
	u32 scaleYQ16 = 0x00010000u;
	u32 control = 0;
};

constexpr size_t SKYBOX_FACE_COUNT = 6;
constexpr size_t SKYBOX_FACE_WORD_STRIDE = 5;
constexpr size_t SKYBOX_FACE_WORD_COUNT = SKYBOX_FACE_COUNT * SKYBOX_FACE_WORD_STRIDE;
constexpr size_t SKYBOX_FACE_SLOT_WORD = 0;
constexpr size_t SKYBOX_FACE_U_WORD = 1;
constexpr size_t SKYBOX_FACE_V_WORD = 2;
constexpr size_t SKYBOX_FACE_W_WORD = 3;
constexpr size_t SKYBOX_FACE_H_WORD = 4;
constexpr u32 VDP_SBX_CONTROL_ENABLE = 1u;
constexpr size_t VDP_PMU_BANK_COUNT = 256;
constexpr size_t VDP_PMU_BANK_WORD_STRIDE = 5;
constexpr size_t VDP_PMU_BANK_WORD_COUNT = VDP_PMU_BANK_COUNT * VDP_PMU_BANK_WORD_STRIDE;
constexpr size_t VDP_PMU_BANK_X_WORD = 0;
constexpr size_t VDP_PMU_BANK_Y_WORD = 1;
constexpr size_t VDP_PMU_BANK_SCALE_X_WORD = 2;
constexpr size_t VDP_PMU_BANK_SCALE_Y_WORD = 3;
constexpr size_t VDP_PMU_BANK_CONTROL_WORD = 4;
constexpr u32 VDP_PMU_Q16_ONE = 0x00010000u;
constexpr size_t VDP_BBU_BILLBOARD_LIMIT = 1024;

} // namespace bmsx
