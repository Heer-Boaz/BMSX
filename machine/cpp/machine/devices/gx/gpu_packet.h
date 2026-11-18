#pragma once

#include "common/primitives.h"
#include "spec/gx/gp0.h"

#include <array>

namespace bmsx {

constexpr u8 GX_GPU_COMMAND_DRAW_POLYGON = 1u;
constexpr u8 GX_GPU_COMMAND_DRAW_LINE = 2u;
constexpr u8 GX_GPU_COMMAND_DRAW_POLYLINE = 3u;
constexpr u8 GX_GPU_COMMAND_DRAW_RECTANGLE = 4u;
constexpr u8 GX_GPU_COMMAND_FILL_RECTANGLE = 5u;
constexpr u8 GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6u;
constexpr u8 GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7u;
constexpr u8 GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8u;
constexpr u8 GX_GPU_SKIPPED_LINE_NONE = 2u;
constexpr u32 GX_GPU_DRAW_MODE_MASK = 0x00003fffu;
constexpr u32 GX_GPU_TEXTURE_WINDOW_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAWING_AREA_MASK = 0x000fffffu;
constexpr u32 GX_GPU_DRAWING_OFFSET_MASK = 0x003fffffu;
constexpr u32 GX_GPU_MASK_BIT_MODE_MASK = 0x3u;

struct GxGpuDrawState {
	u32 drawModeWord = 0u;
	u32 vramYAddressExtensionWord = 0u;
	u32 textureWindowWord = 0u;
	u32 drawingAreaTopLeftWord = 0u;
	u32 drawingAreaBottomRightWord = 0u;
	u32 drawingOffsetWord = 0u;
	u32 maskBitModeWord = 0u;
	// Projected state carries beam parity, independent of E1 draw-to-field.
	u8 skippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
};

struct GxGpuPacket {
	std::array<u32, GX_GPU_GP0_COMMAND_BUFFER_WORDS> words{};
	u8 kind = 0u;
	u8 opcode = 0u;
	u32 wordCount = 0u;
	u32 vertexCount = 0u;
	u8 positionStride = 1u;
	u8 colorStride = 0u;
	u32 sizeOffset = 0u;
	u32 controlWord = 0u;
	u32 textureAttribute = 0u;
	i64 ticks = 0;
	// Packet state carries the effective parity used by timing and emission.
	GxGpuDrawState drawState;
};

} // namespace bmsx
