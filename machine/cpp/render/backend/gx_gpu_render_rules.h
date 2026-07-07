#pragma once

#include "machine/devices/gx/gpu_command_buffer.h"

namespace bmsx {

constexpr i32 GX_GPU_MAX_PRIMITIVE_WIDTH = 1024;
constexpr i32 GX_GPU_MAX_PRIMITIVE_HEIGHT = 512;

inline bool gxGpuDrawModeDitherEnabled(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_DITHER_ENABLED) != 0u;
}

inline bool gxGpuDrawModeTextureRectangleXFlip(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) != 0u;
}

inline bool gxGpuDrawModeTextureRectangleYFlip(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) != 0u;
}

inline i32 gxGpuTextureRectangleEdge0(u32 textureCoord, bool flip) {
	return static_cast<i32>(textureCoord) + (flip ? 1 : 0);
}

inline i32 gxGpuTextureRectangleEdge1(i32 textureEdge0, u32 size, bool flip) {
	return textureEdge0 + (flip ? -static_cast<i32>(size) : static_cast<i32>(size));
}

inline bool gxGpuSegmentExceedsPrimitiveSize(i32 x0, i32 y0, i32 x1, i32 y1) {
	const i32 left = x0 < x1 ? x0 : x1;
	const i32 right = x0 > x1 ? x0 : x1;
	const i32 top = y0 < y1 ? y0 : y1;
	const i32 bottom = y0 > y1 ? y0 : y1;
	return right - left + 1 > GX_GPU_MAX_PRIMITIVE_WIDTH || bottom - top + 1 > GX_GPU_MAX_PRIMITIVE_HEIGHT;
}

inline bool gxGpuTriangleExceedsPrimitiveSize(i32 x0, i32 y0, i32 x1, i32 y1, i32 x2, i32 y2) {
	const i32 min12x = x1 < x2 ? x1 : x2;
	const i32 max12x = x1 > x2 ? x1 : x2;
	const i32 min12y = y1 < y2 ? y1 : y2;
	const i32 max12y = y1 > y2 ? y1 : y2;
	const i32 left = x0 < min12x ? x0 : min12x;
	const i32 right = x0 > max12x ? x0 : max12x;
	const i32 top = y0 < min12y ? y0 : min12y;
	const i32 bottom = y0 > max12y ? y0 : max12y;
	return right - left + 1 > GX_GPU_MAX_PRIMITIVE_WIDTH || bottom - top + 1 > GX_GPU_MAX_PRIMITIVE_HEIGHT;
}

inline bool gxGpuDitheredPolygon(u32 drawModeWord, u32 opcode) {
	return gxGpuDrawModeDitherEnabled(drawModeWord)
		&& (gxGpuCommandDrawsTexture(opcode, drawModeWord)
			? !gxGpuCommandRawTextureEnabled(opcode)
			: gxGpuCommandGouraud(opcode));
}

inline u32 gxGpuDrawModeTexturePageBaseX(u32 drawModeWord) {
	return (drawModeWord & 0x0fu) << 6u;
}

inline u32 gxGpuDrawModeTexturePageBaseY(u32 drawModeWord) {
	return ((drawModeWord >> 4u) & 0x01u) << 8u;
}

inline u32 gxGpuDrawModeTextureMode(u32 drawModeWord) {
	return (drawModeWord >> 7u) & 0x03u;
}

inline u32 gxGpuDrawModeTransparencyMode(u32 drawModeWord) {
	return (drawModeWord >> 5u) & 0x03u;
}

inline u32 gxGpuTextureWindowAndX(u32 textureWindowWord) {
	return (~((textureWindowWord & 0x1fu) << 3u)) & 0xffu;
}

inline u32 gxGpuTextureWindowAndY(u32 textureWindowWord) {
	return (~(((textureWindowWord >> 5u) & 0x1fu) << 3u)) & 0xffu;
}

inline u32 gxGpuTextureWindowOrX(u32 textureWindowWord) {
	return (((textureWindowWord >> 10u) & 0x1fu) & (textureWindowWord & 0x1fu)) << 3u;
}

inline u32 gxGpuTextureWindowOrY(u32 textureWindowWord) {
	return (((textureWindowWord >> 15u) & 0x1fu) & ((textureWindowWord >> 5u) & 0x1fu)) << 3u;
}

inline bool gxGpuMaskBitSetWhileDrawing(u32 maskBitModeWord) {
	return (maskBitModeWord & 0x01u) != 0u;
}

inline bool gxGpuMaskBitCheckBeforeDraw(u32 maskBitModeWord) {
	return (maskBitModeWord & 0x02u) != 0u;
}

inline u32 gxGpuDrawingAreaX(u32 word) {
	return word & 0x3ffu;
}

inline u32 gxGpuDrawingAreaY(u32 word) {
	return (word >> 10u) & 0x3ffu;
}

inline u32 gxGpuDrawingAreaLeft(u32 topLeftWord, u32 bottomRightWord) {
	const u32 left = gxGpuDrawingAreaX(topLeftWord);
	const u32 right = gxGpuDrawingAreaX(bottomRightWord);
	return left > right ? 0u : left;
}

inline u32 gxGpuDrawingAreaTop(u32 topLeftWord, u32 bottomRightWord) {
	const u32 top = gxGpuDrawingAreaY(topLeftWord);
	const u32 bottom = gxGpuDrawingAreaY(bottomRightWord);
	if (top > bottom) {
		return 0u;
	}
	const u32 bottomBound = bottom < GX_GPU_VRAM_HEIGHT ? bottom : GX_GPU_VRAM_HEIGHT - 1u;
	return top < bottomBound ? top : bottomBound;
}

inline u32 gxGpuDrawingAreaRightExclusive(u32 topLeftWord, u32 bottomRightWord) {
	const u32 left = gxGpuDrawingAreaX(topLeftWord);
	const u32 right = gxGpuDrawingAreaX(bottomRightWord);
	if (left > right) {
		return 0u;
	}
	const u32 rightExclusive = right + 1u;
	return rightExclusive < GX_GPU_VRAM_WIDTH ? rightExclusive : GX_GPU_VRAM_WIDTH;
}

inline u32 gxGpuDrawingAreaBottomExclusive(u32 topLeftWord, u32 bottomRightWord) {
	const u32 top = gxGpuDrawingAreaY(topLeftWord);
	const u32 bottom = gxGpuDrawingAreaY(bottomRightWord);
	if (top > bottom) {
		return 0u;
	}
	const u32 bottomExclusive = bottom + 1u;
	return bottomExclusive < GX_GPU_VRAM_HEIGHT ? bottomExclusive : GX_GPU_VRAM_HEIGHT;
}

} // namespace bmsx
