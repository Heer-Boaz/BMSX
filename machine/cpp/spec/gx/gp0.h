#pragma once

#include "common/primitives.h"
#include "spec/gx/vram.h"

namespace bmsx {

constexpr u32 GX_GPU_GP0_DRAW_MODE = 0xe1u;
constexpr u32 GX_GPU_GP0_TEXTURE_WINDOW = 0xe2u;
constexpr u32 GX_GPU_GP0_DRAWING_AREA_TOP_LEFT = 0xe3u;
constexpr u32 GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT = 0xe4u;
constexpr u32 GX_GPU_GP0_DRAWING_OFFSET = 0xe5u;
constexpr u32 GX_GPU_GP0_MASK_BIT = 0xe6u;
constexpr u32 GX_GPU_GP0_IRQ_REQUEST = 0x1fu;
constexpr u32 GX_GPU_GP0_OPCODE_SHIFT = 24u;
constexpr u32 GX_GPU_GP0_PARAM_MASK = 0x00ffffffu;
constexpr u32 GX_GPU_GP0_FILL_RECTANGLE = 0x02u;
constexpr u32 GX_GPU_GP0_POLYGON_FIRST = 0x20u;
constexpr u32 GX_GPU_GP0_POLYGON_LAST = 0x3fu;
constexpr u32 GX_GPU_GP0_LINE_FIRST = 0x40u;
constexpr u32 GX_GPU_GP0_LINE_LAST = 0x5fu;
constexpr u32 GX_GPU_GP0_RECTANGLE_FIRST = 0x60u;
constexpr u32 GX_GPU_GP0_RECTANGLE_LAST = 0x7fu;
constexpr u32 GX_GPU_GP0_VRAM_TO_VRAM_FIRST = 0x80u;
constexpr u32 GX_GPU_GP0_VRAM_TO_VRAM_LAST = 0x9fu;
constexpr u32 GX_GPU_GP0_CPU_TO_VRAM_FIRST = 0xa0u;
constexpr u32 GX_GPU_GP0_CPU_TO_VRAM_LAST = 0xbfu;
constexpr u32 GX_GPU_GP0_VRAM_TO_CPU_FIRST = 0xc0u;
constexpr u32 GX_GPU_GP0_VRAM_TO_CPU_LAST = 0xdfu;
constexpr u32 GX_GPU_GP0_RENDER_TEXTURE_BIT = 0x04u;
constexpr u32 GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT = 0x08u;
constexpr u32 GX_GPU_GP0_RENDER_GOURAUD_BIT = 0x10u;
constexpr u32 GX_GPU_GP0_RECTANGLE_SIZE_MASK = 0x18u;
constexpr u32 GX_GPU_GP0_COMMAND_BUFFER_WORDS = 16u;
constexpr size_t GX_GPU_COMMAND_FIFO_WORD_CAPACITY = 16u;
constexpr size_t GX_GPU_DMA_INGRESS_WORD_CAPACITY = 16u;
constexpr u32 GX_GPU_CLUT_4BIT_WORDS = 16u;
constexpr u32 GX_GPU_CLUT_8BIT_WORDS = 256u;
constexpr u32 GX_GPU_CLUT_4BIT_SIZE_WORD = GX_GPU_CLUT_4BIT_WORDS | (1u << 16u);

constexpr u32 GX_GPU_DMA_DIRECTION_OFF = 0u;
constexpr u32 GX_GPU_DMA_DIRECTION_FIFO = 1u;
constexpr u32 GX_GPU_DMA_DIRECTION_CPU_TO_GP0 = 2u;
constexpr u32 GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU = 3u;

constexpr u32 GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK = 0x09ffu;
constexpr u32 GX_GPU_DRAW_MODE_DITHER_ENABLED = 1u << 9u;
constexpr u32 GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD = 1u << 10u;
constexpr u32 GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH = 1u << 11u;
constexpr u32 GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP = 1u << 12u;
constexpr u32 GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP = 1u << 13u;
constexpr u32 GX_GPU_TEXTURE_MODE_PALETTE4 = 0u;
constexpr u32 GX_GPU_TEXTURE_MODE_PALETTE8 = 1u;
constexpr u32 GX_GPU_TEXTURE_MODE_DIRECT16 = 2u;
constexpr u32 GX_GPU_BLEND_MODE_HALF_BACKGROUND_HALF_FOREGROUND = 0u;
constexpr u32 GX_GPU_BLEND_MODE_BACKGROUND_PLUS_FOREGROUND = 1u;
constexpr u32 GX_GPU_BLEND_MODE_BACKGROUND_MINUS_FOREGROUND = 2u;
constexpr u32 GX_GPU_BLEND_MODE_BACKGROUND_PLUS_QUARTER_FOREGROUND = 3u;
constexpr u32 GX_GPU_TRANSFER_MAX_WIDTH = 1024u;
constexpr u32 GX_GPU_TRANSFER_MAX_HEIGHT = 512u;
constexpr size_t GX_GPU_TRANSFER_MAX_PIXEL_COUNT = static_cast<size_t>(GX_GPU_TRANSFER_MAX_WIDTH) * static_cast<size_t>(GX_GPU_TRANSFER_MAX_HEIGHT);
constexpr size_t GX_GPU_TRANSFER_MAX_BYTE_COUNT = GX_GPU_TRANSFER_MAX_PIXEL_COUNT * 2u;

inline i32 gxGpuSigned11(u32 value) {
	const i32 raw = static_cast<i32>(value & 0x7ffu);
	return (raw & 0x400) != 0 ? raw - 0x800 : raw;
}

inline u32 gxGpuDrawingAreaLeft(u32 topLeftWord, u32 bottomRightWord) {
	const u32 left = topLeftWord & 0x3ffu;
	return left <= (bottomRightWord & 0x3ffu) ? left : 0u;
}

inline u32 gxGpuDrawingAreaTop(u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord) {
	const u32 top = gxGpuVramYAddress(topLeftWord >> 10u, vramYAddressExtensionWord);
	const u32 bottom = gxGpuVramYAddress(bottomRightWord >> 10u, vramYAddressExtensionWord);
	return top <= bottom ? top : 0u;
}

inline u32 gxGpuDrawingAreaRightExclusive(u32 topLeftWord, u32 bottomRightWord) {
	const u32 left = topLeftWord & 0x3ffu;
	const u32 right = bottomRightWord & 0x3ffu;
	if (left > right) return 0u;
	return right < GX_GPU_VRAM_WIDTH - 1u ? right + 1u : GX_GPU_VRAM_WIDTH;
}

inline u32 gxGpuDrawingAreaBottomExclusive(u32 topLeftWord, u32 bottomRightWord, u32 vramYAddressExtensionWord) {
	const u32 top = gxGpuVramYAddress(topLeftWord >> 10u, vramYAddressExtensionWord);
	const u32 bottom = gxGpuVramYAddress(bottomRightWord >> 10u, vramYAddressExtensionWord);
	return top <= bottom ? bottom + 1u : 0u;
}

inline u32 gxGpuTransferWidth(u32 sizeWord) {
	return (((sizeWord & 0xffffu) - 1u) & (GX_GPU_TRANSFER_MAX_WIDTH - 1u)) + 1u;
}

inline u32 gxGpuTransferHeight(u32 sizeWord) {
	return ((((sizeWord >> 16u) & 0xffffu) - 1u) & (GX_GPU_TRANSFER_MAX_HEIGHT - 1u)) + 1u;
}

inline u32 gxGpuTextureAttribute(u32 textureWord) {
	return (textureWord >> 16u) & 0xffffu;
}

inline u32 gxGpuPolygonTexturePageWordIndex(u32 opcode) {
	return (opcode & 0x10u) != 0u ? 5u : 4u;
}

inline u32 gxGpuPolygonDrawModeWord(u32 drawModeWord, u32 textureAttribute) {
	return (textureAttribute & GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK) | (drawModeWord & ~GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK);
}

} // namespace bmsx
