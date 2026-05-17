#pragma once

#include "common/primitives.h"
#include "machine/bus/io.h"

namespace bmsx {

constexpr u32 VDP_REG_SRC_SLOT = 0u;
constexpr u32 VDP_REG_SRC_UV = 1u;
constexpr u32 VDP_REG_SRC_WH = 2u;
constexpr u32 VDP_REG_DST_X = 3u;
constexpr u32 VDP_REG_DST_Y = 4u;
constexpr u32 VDP_REG_GEOM_X0 = 5u;
constexpr u32 VDP_REG_GEOM_Y0 = 6u;
constexpr u32 VDP_REG_GEOM_X1 = 7u;
constexpr u32 VDP_REG_GEOM_Y1 = 8u;
constexpr u32 VDP_REG_LINE_WIDTH = 9u;
constexpr u32 VDP_REG_DRAW_LAYER = 10u;
constexpr u32 VDP_REG_DRAW_PRIORITY = 11u;
constexpr u32 VDP_REG_DRAW_CTRL = 12u;
constexpr u32 VDP_REG_DRAW_SCALE_X = 13u;
constexpr u32 VDP_REG_DRAW_SCALE_Y = 14u;
constexpr u32 VDP_REG_DRAW_COLOR = 15u;
constexpr u32 VDP_REG_BG_COLOR = 16u;
constexpr u32 VDP_REG_SLOT_INDEX = 17u;
constexpr u32 VDP_REG_SLOT_DIM = 18u;
constexpr u32 VDP_REGISTER_COUNT = IO_VDP_CMD_ARG_COUNT;

constexpr u32 VDP_Q16_ONE = 0x00010000u;

constexpr u32 VDP_PKT_KIND_MASK = 0xff000000u;
constexpr u32 VDP_PKT_RESERVED_MASK = 0x00ff0000u;
constexpr u32 VDP_PKT_END = 0x00000000u;
constexpr u32 VDP_PKT_CMD = 0x01000000u;
constexpr u32 VDP_PKT_REG1 = 0x02000000u;
constexpr u32 VDP_PKT_REGN = 0x03000000u;

constexpr u32 VDP_CMD_NOP = 0u;
constexpr u32 VDP_CMD_CLEAR = 1u;
constexpr u32 VDP_CMD_FILL_RECT = 2u;
constexpr u32 VDP_CMD_DRAW_LINE = 3u;
constexpr u32 VDP_CMD_BLIT = 4u;
constexpr u32 VDP_CMD_BATCH_BLIT_BEGIN = 6u;
constexpr u32 VDP_CMD_BATCH_BLIT_ITEM = 7u;
constexpr u32 VDP_CMD_BEGIN_FRAME = 14u;
constexpr u32 VDP_CMD_END_FRAME = 15u;

constexpr u32 VDP_DRAW_CTRL_FLIP_H = 0x00000001u;
constexpr u32 VDP_DRAW_CTRL_FLIP_V = 0x00000002u;
constexpr u32 VDP_DRAW_CTRL_BLEND_SHIFT = 2u;
constexpr u32 VDP_DRAW_CTRL_BLEND_MASK = 0x000000fcu;
constexpr u32 VDP_DRAW_CTRL_PMU_BANK_SHIFT = 8u;
constexpr u32 VDP_DRAW_CTRL_PMU_BANK_MASK = 0x0000ff00u;
constexpr u32 VDP_DRAW_CTRL_PMU_WEIGHT_SHIFT = 16u;

struct VdpLatchedGeometry {
	i32 x0 = 0;
	i32 y0 = 0;
	i32 x1 = 0;
	i32 y1 = 0;
};

struct VdpDrawCtrl {
	bool flipH = false;
	bool flipV = false;
	u32 blendMode = 0u;
	u32 pmuBank = 0u;
	f32 parallaxWeight = 0.0f;
};

VdpDrawCtrl decodeVdpDrawCtrl(u32 value);

} // namespace bmsx
