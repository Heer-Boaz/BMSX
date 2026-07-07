#include "render/backend/software/gx_gpu_rasterizer.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {
namespace {

inline i32 absI32(i32 value) {
	return value < 0 ? -value : value;
}

inline i32 roundDivideSigned(i32 numerator, i32 denominator) {
	return numerator < 0
		? -((-numerator + (denominator >> 1)) / denominator)
		: (numerator + (denominator >> 1)) / denominator;
}

inline i64 edgeValue(i32 ax, i32 ay, i32 bx, i32 by, i32 cx, i32 cy) {
	return static_cast<i64>(cx - ax) * static_cast<i64>(by - ay) - static_cast<i64>(cy - ay) * static_cast<i64>(bx - ax);
}

inline u32 colorR8(u32 colorWord) {
	return colorWord & 0xffu;
}

inline u32 colorG8(u32 colorWord) {
	return (colorWord >> 8u) & 0xffu;
}

inline u32 colorB8(u32 colorWord) {
	return (colorWord >> 16u) & 0xffu;
}

} // namespace

void drawGxGpuSoftwareRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 width, u32 height, u32 colorWord) {
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord));
	const i32 left = x0 > areaLeft ? x0 : areaLeft;
	const i32 top = y0 > areaTop ? y0 : areaTop;
	const i32 rectangleRight = x0 + static_cast<i32>(width);
	const i32 rectangleBottom = y0 + static_cast<i32>(height);
	const i32 right = rectangleRight < areaRight ? rectangleRight : areaRight;
	const i32 bottom = rectangleBottom < areaBottom ? rectangleBottom : areaBottom;
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	const u32 r8 = colorR8(colorWord);
	const u32 g8 = colorG8(colorWord);
	const u32 b8 = colorB8(colorWord);
	for (i32 y = top; y < bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			continue;
		}
		for (i32 x = left; x < right; x += 1) {
			gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, false, blendEnabled, blendMode, maskBitModeWord);
		}
	}
}

void drawGxGpuSoftwareTriangle(
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 x2,
	i32 y2,
	u32 color2,
	bool ditherEnabled) {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return;
	}
	i64 area = edgeValue(x0, y0, x1, y1, x2, y2);
	if (area == 0) {
		return;
	}
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord));
	const i32 min12x = x1 < x2 ? x1 : x2;
	const i32 max12x = x1 > x2 ? x1 : x2;
	const i32 min12y = y1 < y2 ? y1 : y2;
	const i32 max12y = y1 > y2 ? y1 : y2;
	i32 left = x0 < min12x ? x0 : min12x;
	i32 right = x0 > max12x ? x0 : max12x;
	i32 top = y0 < min12y ? y0 : min12y;
	i32 bottom = y0 > max12y ? y0 : max12y;
	left = left > areaLeft ? left : areaLeft;
	top = top > areaTop ? top : areaTop;
	const i32 areaRightInclusive = areaRight - 1;
	const i32 areaBottomInclusive = areaBottom - 1;
	right = right < areaRightInclusive ? right : areaRightInclusive;
	bottom = bottom < areaBottomInclusive ? bottom : areaBottomInclusive;
	const bool flip = area < 0;
	if (flip) {
		area = -area;
	}
	const u32 r0 = colorR8(color0);
	const u32 g0 = colorG8(color0);
	const u32 b0 = colorB8(color0);
	const u32 r1 = colorR8(color1);
	const u32 g1 = colorG8(color1);
	const u32 b1 = colorB8(color1);
	const u32 r2 = colorR8(color2);
	const u32 g2 = colorG8(color2);
	const u32 b2 = colorB8(color2);
	const bool sameColor = color0 == color1 && color0 == color2;
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (i32 y = top; y <= bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			continue;
		}
		for (i32 x = left; x <= right; x += 1) {
			i64 w0 = edgeValue(x1, y1, x2, y2, x, y);
			i64 w1 = edgeValue(x2, y2, x0, y0, x, y);
			i64 w2 = edgeValue(x0, y0, x1, y1, x, y);
			if (flip) {
				w0 = -w0;
				w1 = -w1;
				w2 = -w2;
			}
			if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
				const u32 r8 = sameColor ? r0 : static_cast<u32>((static_cast<i64>(r0) * w0 + static_cast<i64>(r1) * w1 + static_cast<i64>(r2) * w2) / area);
				const u32 g8 = sameColor ? g0 : static_cast<u32>((static_cast<i64>(g0) * w0 + static_cast<i64>(g1) * w1 + static_cast<i64>(g2) * w2) / area);
				const u32 b8 = sameColor ? b0 : static_cast<u32>((static_cast<i64>(b0) * w0 + static_cast<i64>(b1) * w1 + static_cast<i64>(b2) * w2) / area);
				gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
			}
		}
	}
}

void drawGxGpuSoftwareLineSegment(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 color0, i32 x1, i32 y1, u32 color1) {
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		return;
	}
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord));
	const i32 dx = x1 - x0;
	const i32 dy = y1 - y0;
	const i32 absDx = absI32(dx);
	const i32 absDy = absI32(dy);
	const i32 steps = absDx >= absDy ? absDx : absDy;
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const bool ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	const u32 r0 = colorR8(color0);
	const u32 g0 = colorG8(color0);
	const u32 b0 = colorB8(color0);
	const i32 dr = static_cast<i32>(colorR8(color1)) - static_cast<i32>(r0);
	const i32 dg = static_cast<i32>(colorG8(color1)) - static_cast<i32>(g0);
	const i32 db = static_cast<i32>(colorB8(color1)) - static_cast<i32>(b0);
	if (steps == 0) {
		if (x0 >= areaLeft && y0 >= areaTop && x0 < areaRight && y0 < areaBottom && !gxGpuSoftwareInterlacedSkipsLine(y0, interlacedRenderWord)) {
			gxGpuSoftwareWriteRenderVramPixel(x0, y0, r0, g0, b0, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
		}
		return;
	}
	for (i32 step = 0; step <= steps; step += 1) {
		const i32 x = x0 + roundDivideSigned(dx * step, steps);
		const i32 y = y0 + roundDivideSigned(dy * step, steps);
		if (x >= areaLeft && y >= areaTop && x < areaRight && y < areaBottom && !gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			const u32 r8 = static_cast<u32>(static_cast<i32>(r0) + roundDivideSigned(dr * step, steps));
			const u32 g8 = static_cast<u32>(static_cast<i32>(g0) + roundDivideSigned(dg * step, steps));
			const u32 b8 = static_cast<u32>(static_cast<i32>(b0) + roundDivideSigned(db * step, steps));
			gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
		}
	}
}

} // namespace bmsx
