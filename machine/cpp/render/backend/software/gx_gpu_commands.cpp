#include "render/backend/software/gx_gpu_commands.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <array>

namespace bmsx {
namespace {

std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareCopyScratch{};

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

void executeFillRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u16 colorWord = gxGpuSoftwareRgb888WordToRgb555(commandBuffer.words[wordStart]);
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const i32 x = static_cast<i32>(gxGpuFillX(xyWord));
	const i32 y = static_cast<i32>(gxGpuTransferY(xyWord));
	const i32 width = static_cast<i32>(gxGpuFillWidth(sizeWord));
	const i32 height = static_cast<i32>(gxGpuFillHeight(sizeWord));
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (i32 row = 0; row < height; row += 1) {
		const i32 targetY = (y + row) & static_cast<i32>(GX_GPU_VRAM_HEIGHT - 1u);
		if (gxGpuSoftwareInterlacedSkipsLine(targetY, interlacedRenderWord)) {
			continue;
		}
		for (i32 column = 0; column < width; column += 1) {
			g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x + column, targetY)] = colorWord;
		}
	}
}

void executeCpuToVram(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const i32 x = static_cast<i32>(gxGpuTransferX(xyWord));
	const i32 y = static_cast<i32>(gxGpuTransferY(xyWord));
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 emittedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	u32 emittedPixel = 0u;
	for (u32 row = 0u; row < height && emittedPixel < emittedPixels; row += 1u) {
		const u32 rowRemaining = emittedPixels - emittedPixel;
		const u32 rowWidth = rowRemaining < width ? rowRemaining : width;
		const i32 targetY = (y + static_cast<i32>(row)) & static_cast<i32>(GX_GPU_VRAM_HEIGHT - 1u);
		for (u32 column = 0u; column < rowWidth; column += 1u) {
			const u32 payloadWord = commandBuffer.words[payloadWordStart + (emittedPixel >> 1u)];
			gxGpuSoftwareWriteMaskedVramWord(gxGpuSoftwareVramIndex(x + static_cast<i32>(column), targetY), gxGpuTransferPixelWord(payloadWord, emittedPixel), maskBitModeWord);
			emittedPixel += 1u;
		}
	}
}

void copyVramArea(i32 sourceX, i32 sourceY, i32 targetX, i32 targetY, u32 width, u32 height, u32 maskBitModeWord) {
	size_t scratchIndex = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const i32 rowSourceY = sourceY + static_cast<i32>(row);
		for (u32 column = 0u; column < width; column += 1u) {
			g_gxGpuSoftwareCopyScratch[scratchIndex] = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(sourceX + static_cast<i32>(column), rowSourceY)];
			scratchIndex += 1u;
		}
	}
	scratchIndex = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const i32 rowTargetY = targetY + static_cast<i32>(row);
		for (u32 column = 0u; column < width; column += 1u) {
			gxGpuSoftwareWriteMaskedVramWord(gxGpuSoftwareVramIndex(targetX + static_cast<i32>(column), rowTargetY), g_gxGpuSoftwareCopyScratch[scratchIndex], maskBitModeWord);
			scratchIndex += 1u;
		}
	}
}

void executeVramToVram(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	copyVramArea(
		static_cast<i32>(gxGpuTransferX(sourceWord)),
		static_cast<i32>(gxGpuTransferY(sourceWord)),
		static_cast<i32>(gxGpuTransferX(targetWord)),
		static_cast<i32>(gxGpuTransferY(targetWord)),
		gxGpuTransferWidth(sizeWord),
		gxGpuTransferHeight(sizeWord),
		commandBuffer.commandMaskBitModeWord[commandIndex]);
}

void drawSoftwareRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 width, u32 height, u32 colorWord) {
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

void drawSoftwareTriangle(
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

void drawSoftwareLineSegment(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 color0, i32 x1, i32 y1, u32 color1) {
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

void executeDrawPolygon(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		return;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool ditherEnabled = gxGpuDitheredPolygon(drawModeWord, opcode);
	const bool gouraud = gxGpuCommandGouraud(opcode);
	if (gxGpuCommandTextureEnabled(opcode)) {
		if (gouraud) {
			const u32 color0 = commandBuffer.words[wordStart];
			const u32 xy0 = commandBuffer.words[wordStart + 1u];
			const u32 color1 = commandBuffer.words[wordStart + 3u];
			const u32 xy1 = commandBuffer.words[wordStart + 4u];
			const u32 color2 = commandBuffer.words[wordStart + 6u];
			const u32 xy2 = commandBuffer.words[wordStart + 7u];
			drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const u32 color3 = commandBuffer.words[wordStart + 9u];
				const u32 xy3 = commandBuffer.words[wordStart + 10u];
				drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
			}
			return;
		}

		const u32 color = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		const u32 xy2 = commandBuffer.words[wordStart + 5u];
		drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 xy3 = commandBuffer.words[wordStart + 7u];
			drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
		}
		return;
	}

	if (gouraud) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 color1 = commandBuffer.words[wordStart + 2u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		const u32 color2 = commandBuffer.words[wordStart + 4u];
		const u32 xy2 = commandBuffer.words[wordStart + 5u];
		drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 color3 = commandBuffer.words[wordStart + 6u];
			const u32 xy3 = commandBuffer.words[wordStart + 7u];
			drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
		}
		return;
	}

	const u32 color = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 xy1 = commandBuffer.words[wordStart + 2u];
	const u32 xy2 = commandBuffer.words[wordStart + 3u];
	drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const u32 xy3 = commandBuffer.words[wordStart + 4u];
		drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
	}
}

void executeDrawRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		return;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1u];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 x = gxGpuDrawingOffsetX(drawingOffsetWord) + gxGpuVertexX(xyWord);
	const i32 y = gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord);
	drawSoftwareRectangle(commandBuffer, commandIndex, x, y, width, height, colorWord);
}

void executeDrawLine(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	if (gxGpuCommandGouraud(opcode)) {
		const u32 color1 = commandBuffer.words[wordStart + 2u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
		return;
	}
	const u32 xy1 = commandBuffer.words[wordStart + 2u];
	drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color0);
}

void executeDrawPolyline(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		u32 color0 = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex + 1u < wordEnd; wordIndex += 2u) {
			const u32 color1 = commandBuffer.words[wordIndex];
			const u32 xy1 = commandBuffer.words[wordIndex + 1u];
			drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
		return;
	}
	const u32 color = commandBuffer.words[wordStart];
	u32 xy0 = commandBuffer.words[wordStart + 1u];
	for (u32 wordIndex = wordStart + 2u; wordIndex < wordEnd; wordIndex += 1u) {
		const u32 xy1 = commandBuffer.words[wordIndex];
		drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color);
		xy0 = xy1;
	}
}

} // namespace

size_t executeGxGpuSoftwareCommands(const GxGpuCommandBuffer& commandBuffer, size_t processedCommandCount) {
	for (size_t commandIndex = processedCommandCount; commandIndex < commandBuffer.commandCount; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
				executeDrawPolygon(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_LINE:
				executeDrawLine(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_POLYLINE:
				executeDrawPolyline(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_RECTANGLE:
				executeDrawRectangle(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				executeFillRectangle(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				executeVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				executeCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	return commandBuffer.commandCount;
}

} // namespace bmsx
