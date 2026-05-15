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
constexpr size_t VDP_MFU_WEIGHT_COUNT = 64;
constexpr size_t VDP_JTU_MATRIX_WORDS = 16;
constexpr size_t VDP_JTU_MATRIX_COUNT = 32;
constexpr size_t VDP_JTU_REGISTER_WORDS = VDP_JTU_MATRIX_WORDS * VDP_JTU_MATRIX_COUNT;
constexpr size_t VDP_MDU_MESH_LIMIT = 1024;
constexpr size_t VDP_MDU_VERTEX_LIMIT = 65536;
constexpr size_t VDP_MDU_MORPH_WEIGHT_LIMIT = 8;
constexpr uint32_t VDP_MDU_MATERIAL_MESH_DEFAULT = 0xffffffffu;
constexpr uint32_t VDP_MDU_CONTROL_TEXTURE_ENABLE = 1u << 0u;
constexpr uint32_t VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT = 1u;
constexpr uint32_t VDP_MDU_CONTROL_TEXTURE_SLOT_MASK = 0x3u << VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT;
constexpr uint32_t VDP_RD_SURFACE_SYSTEM = 0u;
constexpr uint32_t VDP_RD_SURFACE_PRIMARY = 1u;
constexpr uint32_t VDP_RD_SURFACE_SECONDARY = 2u;
constexpr uint32_t VDP_RD_SURFACE_FRAMEBUFFER = 3u;
constexpr uint32_t VDP_RD_SURFACE_COUNT = 4u;
constexpr uint32_t VDP_SLOT_PRIMARY = 0u;
constexpr uint32_t VDP_SLOT_SECONDARY = 1u;
constexpr uint32_t VDP_SLOT_SYSTEM = 2u;
constexpr uint32_t VDP_SYSTEM_ATLAS_ID = 254u;
constexpr uint32_t VDP_SLOT_NONE = 0xffffffffu;
constexpr uint32_t VDP_SLOT_ATLAS_NONE = 0xffffffffu;
constexpr uint32_t VDP_RD_MODE_RGBA8888 = 0u;
constexpr uint32_t VDP_RD_STATUS_READY = 1u << 0u;
constexpr uint32_t VDP_RD_STATUS_OVERFLOW = 1u << 1u;
constexpr uint32_t VDP_FIFO_CTRL_SEAL = 1u << 0u;
constexpr uint32_t VDP_STATUS_VBLANK = 1u << 0u;
constexpr uint32_t VDP_STATUS_SUBMIT_BUSY = 1u << 1u;
constexpr uint32_t VDP_STATUS_SUBMIT_REJECTED = 1u << 2u;
constexpr uint32_t VDP_STATUS_FAULT = 1u << 3u;
constexpr uint32_t VDP_SBX_COMMIT_WRITE = 1u;
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
constexpr uint32_t VDP_FAULT_SBX_SOURCE_OOB = 0x0401u;
constexpr uint32_t VDP_FAULT_BBU_ZERO_SIZE = 0x0501u;
constexpr uint32_t VDP_FAULT_BBU_OVERFLOW = 0x0502u;
constexpr uint32_t VDP_FAULT_BBU_SOURCE_OOB = 0x0503u;
constexpr uint32_t VDP_FAULT_MDU_OVERFLOW = 0x0601u;
constexpr uint32_t VDP_FAULT_MDU_BAD_MATRIX = 0x0602u;
constexpr uint32_t VDP_FAULT_MDU_BAD_MORPH_RANGE = 0x0603u;
constexpr uint32_t VDP_FAULT_MDU_BAD_JOINT_RANGE = 0x0604u;
constexpr uint32_t VDP_FAULT_MDU_BAD_TEXTURE_SLOT = 0x0605u;

enum class VdpFrameBufferPage : u8 {
	Render,
	Display,
};

} // namespace bmsx
