#pragma once

#include "common/primitives.h"
#include <cstddef>

namespace bmsx {

enum class Layer2D : u8 {
	World = 0,
	UI = 1,
	IDE = 2,
};

constexpr u32 LAYER_2D_WORLD = 0u;
constexpr u32 LAYER_2D_UI = 1u;
constexpr u32 LAYER_2D_IDE = 2u;

struct VdpSlotSource {
	u32 slot = 0;
	u32 u = 0;
	u32 v = 0;
	u32 w = 0;
	u32 h = 0;
};

constexpr size_t VDP_MFU_WEIGHT_COUNT = 64;
constexpr size_t VDP_JTU_MATRIX_WORDS = 16;
constexpr size_t VDP_JTU_MATRIX_COUNT = 32;
constexpr size_t VDP_JTU_REGISTER_WORDS = VDP_JTU_MATRIX_WORDS * VDP_JTU_MATRIX_COUNT;
constexpr uint32_t VDP_RD_SURFACE_SYSTEM = 0u;
constexpr uint32_t VDP_RD_SURFACE_PRIMARY = 1u;
constexpr uint32_t VDP_RD_SURFACE_SECONDARY = 2u;
constexpr uint32_t VDP_RD_SURFACE_FRAMEBUFFER = 3u;
constexpr uint32_t VDP_RD_SURFACE_COUNT = 4u;
constexpr uint32_t VDP_SLOT_PRIMARY = 0u;
constexpr uint32_t VDP_SLOT_SECONDARY = 1u;
constexpr uint32_t VDP_SLOT_SYSTEM = 2u;
constexpr uint32_t VDP_SLOT_NONE = 0xffffffffu;
constexpr uint32_t VDP_RD_MODE_RGBA8888 = 0u;
constexpr uint32_t VDP_RD_STATUS_READY = 1u << 0u;
constexpr uint32_t VDP_RD_STATUS_OVERFLOW = 1u << 1u;
constexpr uint32_t VDP_FIFO_CTRL_SEAL = 1u << 0u;
constexpr uint32_t VDP_STATUS_VBLANK = 1u << 0u;
constexpr uint32_t VDP_STATUS_SUBMIT_BUSY = 1u << 1u;
constexpr uint32_t VDP_STATUS_SUBMIT_REJECTED = 1u << 2u;
constexpr uint32_t VDP_STATUS_FAULT = 1u << 3u;
constexpr uint32_t VDP_FAULT_NONE = 0u;
constexpr uint32_t VDP_FAULT_RD_UNSUPPORTED_MODE = 0x0001u;
constexpr uint32_t VDP_FAULT_RD_SURFACE = 0x0002u;
constexpr uint32_t VDP_FAULT_RD_OOB = 0x0003u;
constexpr uint32_t VDP_FAULT_VRAM_WRITE_UNMAPPED = 0x0101u;
constexpr uint32_t VDP_FAULT_VRAM_WRITE_UNINITIALIZED = 0x0102u;
constexpr uint32_t VDP_FAULT_VRAM_WRITE_OOB = 0x0103u;
constexpr uint32_t VDP_FAULT_VRAM_WRITE_UNALIGNED = 0x0104u;
constexpr uint32_t VDP_FAULT_VRAM_SLOT_DIM = 0x0105u;
constexpr uint32_t VDP_FAULT_STREAM_BAD_PACKET = 0x0201u;
constexpr uint32_t VDP_FAULT_SUBMIT_STATE = 0x0202u;
constexpr uint32_t VDP_FAULT_CMD_BAD_DOORBELL = 0x0203u;
constexpr uint32_t VDP_FAULT_SUBMIT_BUSY = 0x0204u;
constexpr uint32_t VDP_FAULT_DEX_INVALID_SCALE = 0x0301u;
constexpr uint32_t VDP_FAULT_DEX_INVALID_LINE_WIDTH = 0x0302u;
constexpr uint32_t VDP_FAULT_DEX_SOURCE_SLOT = 0x0303u;
constexpr uint32_t VDP_FAULT_DEX_SOURCE_OOB = 0x0304u;
constexpr uint32_t VDP_FAULT_DEX_OVERFLOW = 0x0305u;
constexpr uint32_t VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL = 0x0306u;
constexpr uint32_t VDP_FAULT_DEX_CMD_NO_BATCH = 0x0307u;
constexpr uint32_t VDP_FAULT_BLITTER_OOM_BATCH = 0x0308u;

constexpr u32 VDP_FRAMEBUFFER_PAGE_RENDER = 0u;
constexpr u32 VDP_FRAMEBUFFER_PAGE_DISPLAY = 1u;

enum class VdpFrameBufferPage : u8 {
	Render,
	Display,
};

} // namespace bmsx
