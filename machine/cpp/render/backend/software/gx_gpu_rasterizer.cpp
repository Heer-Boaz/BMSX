#include "render/backend/software/gx_gpu_rasterizer.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {
namespace {

inline i32 absI32(i32 value) {
	return value < 0 ? -value : value;
}

constexpr i64 kGxGpuSoftwareLineXYScale = 0x100000000ll;
constexpr i64 kGxGpuSoftwareLineXYHalf = 0x80000000ll;
constexpr i64 kGxGpuSoftwareLineSubpixelBias = 1024;
constexpr i32 kGxGpuSoftwareLineRGBScale = 0x1000;
constexpr i32 kGxGpuSoftwareLineRGBHalf = 0x800;

inline i64 lineMakeFixedXY(i32 value) {
	return static_cast<i64>(value) * kGxGpuSoftwareLineXYScale + kGxGpuSoftwareLineXYHalf;
}

inline i64 lineDivideFixedXYDelta(i64 delta, i32 steps) {
	return (delta * kGxGpuSoftwareLineXYScale - ((delta < 0) ? (steps - 1) : 0) + ((delta > 0) ? (steps - 1) : 0)) / steps;
}

inline i32 lineFixedXYToCoord(i64 value) {
	const i64 quotient = value / kGxGpuSoftwareLineXYScale;
	return static_cast<i32>(value < 0 && (value % kGxGpuSoftwareLineXYScale) != 0 ? quotient - 1 : quotient);
}

inline i32 lineMakeFixedRgb(u32 value) {
	return static_cast<i32>(value) * kGxGpuSoftwareLineRGBScale + kGxGpuSoftwareLineRGBHalf;
}

inline i32 lineDivideFixedRgbDelta(u32 value1, u32 value0, i32 steps) {
	return ((static_cast<i32>(value1) - static_cast<i32>(value0)) * kGxGpuSoftwareLineRGBScale) / steps;
}

inline u32 lineFixedRgbToByte(i32 value) {
	return static_cast<u32>(static_cast<u8>(value / kGxGpuSoftwareLineRGBScale));
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

inline u32 textureWindowCoord(i32 coord, u32 andMask, u32 orMask) {
	return (static_cast<u32>(coord) & andMask) | orMask;
}

inline u32 sampleGxGpuSoftwareTextureWord(
	i32 u,
	i32 v,
	u32 pageX,
	u32 pageY,
	u32 textureMode,
	u32 textureWindowAndX,
	u32 textureWindowAndY,
	u32 textureWindowOrX,
	u32 textureWindowOrY,
	u32 clutBaseX,
	u32 clutBaseY) {
	const u32 windowedU = textureWindowCoord(u, textureWindowAndX, textureWindowOrX);
	const u32 windowedV = textureWindowCoord(v, textureWindowAndY, textureWindowOrY);
	if (textureMode == GX_GPU_TEXTURE_MODE_PALETTE4) {
		const u32 textureWord = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(pageX + (windowedU / 4u)), static_cast<i32>(pageY + windowedV))];
		const u32 paletteIndex = (textureWord >> ((windowedU & 3u) << 2u)) & 0x0fu;
		return g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(clutBaseX + paletteIndex), static_cast<i32>(clutBaseY))];
	}
	if (textureMode == GX_GPU_TEXTURE_MODE_PALETTE8) {
		const u32 textureWord = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(pageX + (windowedU / 2u)), static_cast<i32>(pageY + windowedV))];
		const u32 paletteIndex = (textureWord >> ((windowedU & 1u) << 3u)) & 0xffu;
		return g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(clutBaseX + paletteIndex), static_cast<i32>(clutBaseY))];
	}
	return g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(pageX + windowedU), static_cast<i32>(pageY + windowedV))];
}

inline void writeGxGpuSoftwareTexturedPixel(
	i32 x,
	i32 y,
	u32 colorR,
	u32 colorG,
	u32 colorB,
	u32 sampleWord,
	bool ditherEnabled,
	bool rawTextureEnabled,
	bool semiTransparencyEnabled,
	u32 blendMode,
	u32 maskBitModeWord) {
	if (sampleWord == 0u) {
		return;
	}
	u32 r5 = sampleWord & 0x1fu;
	u32 g5 = (sampleWord >> 5u) & 0x1fu;
	u32 b5 = (sampleWord >> 10u) & 0x1fu;
	if (!rawTextureEnabled) {
		const i32 ditherOffset = ditherEnabled ? gxGpuSoftwareDitherOffset(x, y) : 0;
		r5 = gxGpuSoftwareTextureModulationChannel5(r5, colorR, ditherOffset);
		g5 = gxGpuSoftwareTextureModulationChannel5(g5, colorG, ditherOffset);
		b5 = gxGpuSoftwareTextureModulationChannel5(b5, colorB, ditherOffset);
	}
	const u32 sampleMaskBit = sampleWord & 0x8000u;
	const bool blendEnabled = semiTransparencyEnabled && sampleMaskBit != 0u;
	gxGpuSoftwareWriteRenderVramPixel5(x, y, r5, g5, b5, blendEnabled, blendMode, maskBitModeWord, sampleMaskBit);
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
	i32 rightExclusive = x0 > max12x ? x0 : max12x;
	i32 top = y0 < min12y ? y0 : min12y;
	i32 bottomExclusive = y0 > max12y ? y0 : max12y;
	left = left > areaLeft ? left : areaLeft;
	top = top > areaTop ? top : areaTop;
	rightExclusive = rightExclusive < areaRight ? rightExclusive : areaRight;
	bottomExclusive = bottomExclusive < areaBottom ? bottomExclusive : areaBottom;
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
	const i64 edgeSign = flip ? -1 : 1;
	const i64 edge0StepX = static_cast<i64>(y2 - y1) * edgeSign;
	const i64 edge1StepX = static_cast<i64>(y0 - y2) * edgeSign;
	const i64 edge2StepX = static_cast<i64>(y1 - y0) * edgeSign;
	const i64 edge0StepY = -static_cast<i64>(x2 - x1) * edgeSign;
	const i64 edge1StepY = -static_cast<i64>(x0 - x2) * edgeSign;
	const i64 edge2StepY = -static_cast<i64>(x1 - x0) * edgeSign;
	i64 rowW0 = edgeValue(x1, y1, x2, y2, left, top) * edgeSign;
	i64 rowW1 = edgeValue(x2, y2, x0, y0, left, top) * edgeSign;
	i64 rowW2 = edgeValue(x0, y0, x1, y1, left, top) * edgeSign;
	const i64 rStepX = sameColor ? 0 : static_cast<i64>(r0) * edge0StepX + static_cast<i64>(r1) * edge1StepX + static_cast<i64>(r2) * edge2StepX;
	const i64 gStepX = sameColor ? 0 : static_cast<i64>(g0) * edge0StepX + static_cast<i64>(g1) * edge1StepX + static_cast<i64>(g2) * edge2StepX;
	const i64 bStepX = sameColor ? 0 : static_cast<i64>(b0) * edge0StepX + static_cast<i64>(b1) * edge1StepX + static_cast<i64>(b2) * edge2StepX;
	const i64 rStepY = sameColor ? 0 : static_cast<i64>(r0) * edge0StepY + static_cast<i64>(r1) * edge1StepY + static_cast<i64>(r2) * edge2StepY;
	const i64 gStepY = sameColor ? 0 : static_cast<i64>(g0) * edge0StepY + static_cast<i64>(g1) * edge1StepY + static_cast<i64>(g2) * edge2StepY;
	const i64 bStepY = sameColor ? 0 : static_cast<i64>(b0) * edge0StepY + static_cast<i64>(b1) * edge1StepY + static_cast<i64>(b2) * edge2StepY;
	i64 rowR = sameColor ? 0 : static_cast<i64>(r0) * rowW0 + static_cast<i64>(r1) * rowW1 + static_cast<i64>(r2) * rowW2;
	i64 rowG = sameColor ? 0 : static_cast<i64>(g0) * rowW0 + static_cast<i64>(g1) * rowW1 + static_cast<i64>(g2) * rowW2;
	i64 rowB = sameColor ? 0 : static_cast<i64>(b0) * rowW0 + static_cast<i64>(b1) * rowW1 + static_cast<i64>(b2) * rowW2;
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	for (i32 y = top; y < bottomExclusive; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			rowW0 += edge0StepY;
			rowW1 += edge1StepY;
			rowW2 += edge2StepY;
			if (!sameColor) {
				rowR += rStepY;
				rowG += gStepY;
				rowB += bStepY;
			}
			continue;
		}
		i64 w0 = rowW0;
		i64 w1 = rowW1;
		i64 w2 = rowW2;
		i64 r = rowR;
		i64 g = rowG;
		i64 b = rowB;
		for (i32 x = left; x < rightExclusive; x += 1) {
			if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
				const u32 r8 = sameColor ? r0 : static_cast<u32>(r / area);
				const u32 g8 = sameColor ? g0 : static_cast<u32>(g / area);
				const u32 b8 = sameColor ? b0 : static_cast<u32>(b / area);
				gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
			}
			w0 += edge0StepX;
			w1 += edge1StepX;
			w2 += edge2StepX;
			if (!sameColor) {
				r += rStepX;
				g += gStepX;
				b += bStepX;
			}
		}
		rowW0 += edge0StepY;
		rowW1 += edge1StepY;
		rowW2 += edge2StepY;
		if (!sameColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
	}
}

void drawGxGpuSoftwareTexturedTriangle(
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 u0,
	i32 v0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 u1,
	i32 v1,
	i32 x2,
	i32 y2,
	u32 color2,
	i32 u2,
	i32 v2,
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
	i32 rightExclusive = x0 > max12x ? x0 : max12x;
	i32 top = y0 < min12y ? y0 : min12y;
	i32 bottomExclusive = y0 > max12y ? y0 : max12y;
	left = left > areaLeft ? left : areaLeft;
	top = top > areaTop ? top : areaTop;
	rightExclusive = rightExclusive < areaRight ? rightExclusive : areaRight;
	bottomExclusive = bottomExclusive < areaBottom ? bottomExclusive : areaBottom;
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
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 textureWord0 = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const u32 textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const u32 textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const u32 textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const u32 textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const u32 textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const u32 clutBaseX = gxGpuTextureClutBaseX(textureWord0);
	const u32 clutBaseY = gxGpuTextureClutBaseY(textureWord0);
	const bool rawTextureEnabled = gxGpuCommandRawTextureEnabled(opcode);
	const bool semiTransparencyEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	const i64 edgeSign = flip ? -1 : 1;
	const i64 edge0StepX = static_cast<i64>(y2 - y1) * edgeSign;
	const i64 edge1StepX = static_cast<i64>(y0 - y2) * edgeSign;
	const i64 edge2StepX = static_cast<i64>(y1 - y0) * edgeSign;
	const i64 edge0StepY = -static_cast<i64>(x2 - x1) * edgeSign;
	const i64 edge1StepY = -static_cast<i64>(x0 - x2) * edgeSign;
	const i64 edge2StepY = -static_cast<i64>(x1 - x0) * edgeSign;
	i64 rowW0 = edgeValue(x1, y1, x2, y2, left, top) * edgeSign;
	i64 rowW1 = edgeValue(x2, y2, x0, y0, left, top) * edgeSign;
	i64 rowW2 = edgeValue(x0, y0, x1, y1, left, top) * edgeSign;
	const i64 rStepX = sameColor ? 0 : static_cast<i64>(r0) * edge0StepX + static_cast<i64>(r1) * edge1StepX + static_cast<i64>(r2) * edge2StepX;
	const i64 gStepX = sameColor ? 0 : static_cast<i64>(g0) * edge0StepX + static_cast<i64>(g1) * edge1StepX + static_cast<i64>(g2) * edge2StepX;
	const i64 bStepX = sameColor ? 0 : static_cast<i64>(b0) * edge0StepX + static_cast<i64>(b1) * edge1StepX + static_cast<i64>(b2) * edge2StepX;
	const i64 uStepX = static_cast<i64>(u0) * edge0StepX + static_cast<i64>(u1) * edge1StepX + static_cast<i64>(u2) * edge2StepX;
	const i64 vStepX = static_cast<i64>(v0) * edge0StepX + static_cast<i64>(v1) * edge1StepX + static_cast<i64>(v2) * edge2StepX;
	const i64 rStepY = sameColor ? 0 : static_cast<i64>(r0) * edge0StepY + static_cast<i64>(r1) * edge1StepY + static_cast<i64>(r2) * edge2StepY;
	const i64 gStepY = sameColor ? 0 : static_cast<i64>(g0) * edge0StepY + static_cast<i64>(g1) * edge1StepY + static_cast<i64>(g2) * edge2StepY;
	const i64 bStepY = sameColor ? 0 : static_cast<i64>(b0) * edge0StepY + static_cast<i64>(b1) * edge1StepY + static_cast<i64>(b2) * edge2StepY;
	const i64 uStepY = static_cast<i64>(u0) * edge0StepY + static_cast<i64>(u1) * edge1StepY + static_cast<i64>(u2) * edge2StepY;
	const i64 vStepY = static_cast<i64>(v0) * edge0StepY + static_cast<i64>(v1) * edge1StepY + static_cast<i64>(v2) * edge2StepY;
	i64 rowR = sameColor ? 0 : static_cast<i64>(r0) * rowW0 + static_cast<i64>(r1) * rowW1 + static_cast<i64>(r2) * rowW2;
	i64 rowG = sameColor ? 0 : static_cast<i64>(g0) * rowW0 + static_cast<i64>(g1) * rowW1 + static_cast<i64>(g2) * rowW2;
	i64 rowB = sameColor ? 0 : static_cast<i64>(b0) * rowW0 + static_cast<i64>(b1) * rowW1 + static_cast<i64>(b2) * rowW2;
	i64 rowU = static_cast<i64>(u0) * rowW0 + static_cast<i64>(u1) * rowW1 + static_cast<i64>(u2) * rowW2;
	i64 rowV = static_cast<i64>(v0) * rowW0 + static_cast<i64>(v1) * rowW1 + static_cast<i64>(v2) * rowW2;
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	for (i32 y = top; y < bottomExclusive; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			rowW0 += edge0StepY;
			rowW1 += edge1StepY;
			rowW2 += edge2StepY;
			if (!sameColor) {
				rowR += rStepY;
				rowG += gStepY;
				rowB += bStepY;
			}
			rowU += uStepY;
			rowV += vStepY;
			continue;
		}
		i64 w0 = rowW0;
		i64 w1 = rowW1;
		i64 w2 = rowW2;
		i64 r = rowR;
		i64 g = rowG;
		i64 b = rowB;
		i64 uNumerator = rowU;
		i64 vNumerator = rowV;
		for (i32 x = left; x < rightExclusive; x += 1) {
			if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
				const u32 r8 = sameColor ? r0 : static_cast<u32>(r / area);
				const u32 g8 = sameColor ? g0 : static_cast<u32>(g / area);
				const u32 b8 = sameColor ? b0 : static_cast<u32>(b / area);
				const i32 u = static_cast<i32>(uNumerator / area);
				const i32 v = static_cast<i32>(vNumerator / area);
				const u32 sampleWord = sampleGxGpuSoftwareTextureWord(
					u,
					v,
					pageX,
					pageY,
					textureMode,
					textureWindowAndX,
					textureWindowAndY,
					textureWindowOrX,
					textureWindowOrY,
					clutBaseX,
					clutBaseY);
				writeGxGpuSoftwareTexturedPixel(
					x,
					y,
					r8,
					g8,
					b8,
					sampleWord,
					ditherEnabled,
					rawTextureEnabled,
					semiTransparencyEnabled,
					blendMode,
					maskBitModeWord);
			}
			w0 += edge0StepX;
			w1 += edge1StepX;
			w2 += edge2StepX;
			if (!sameColor) {
				r += rStepX;
				g += gStepX;
				b += bStepX;
			}
			uNumerator += uStepX;
			vNumerator += vStepX;
		}
		rowW0 += edge0StepY;
		rowW1 += edge1StepY;
		rowW2 += edge2StepY;
		if (!sameColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
		rowU += uStepY;
		rowV += vStepY;
	}
}

void drawGxGpuSoftwareTexturedRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 width, u32 height, u32 colorWord, u32 textureWord) {
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
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const bool yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const i32 baseU = static_cast<i32>(gxGpuTextureU(textureWord));
	const i32 baseV = static_cast<i32>(gxGpuTextureV(textureWord));
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const u32 textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const u32 textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const u32 textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const u32 textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const u32 textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const u32 clutBaseX = gxGpuTextureClutBaseX(textureWord);
	const u32 clutBaseY = gxGpuTextureClutBaseY(textureWord);
	const bool rawTextureEnabled = gxGpuCommandRawTextureEnabled(opcode);
	const bool semiTransparencyEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
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
		const i32 textureY = y - y0;
		const i32 v = yFlip ? baseV - textureY : baseV + textureY;
		for (i32 x = left; x < right; x += 1) {
			const i32 textureX = x - x0;
			const i32 u = xFlip ? baseU - textureX : baseU + textureX;
			const u32 sampleWord = sampleGxGpuSoftwareTextureWord(
				u,
				v,
				pageX,
				pageY,
				textureMode,
				textureWindowAndX,
				textureWindowAndY,
				textureWindowOrX,
				textureWindowOrY,
				clutBaseX,
				clutBaseY);
			writeGxGpuSoftwareTexturedPixel(
				x,
				y,
				r8,
				g8,
				b8,
				sampleWord,
				false,
				rawTextureEnabled,
				semiTransparencyEnabled,
				blendMode,
				maskBitModeWord);
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
	const i32 absDx = absI32(x1 - x0);
	const i32 absDy = absI32(y1 - y0);
	const i32 steps = absDx >= absDy ? absDx : absDy;
	if (x0 >= x1 && steps > 0) {
		const i32 swapX = x0;
		const i32 swapY = y0;
		const u32 swapColor = color0;
		x0 = x1;
		y0 = y1;
		color0 = color1;
		x1 = swapX;
		y1 = swapY;
		color1 = swapColor;
	}
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const bool ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	i64 xStep = 0;
	i64 yStep = 0;
	i32 rStep = 0;
	i32 gStep = 0;
	i32 bStep = 0;
	const u32 r0 = colorR8(color0);
	const u32 g0 = colorG8(color0);
	const u32 b0 = colorB8(color0);
	if (steps != 0) {
		xStep = lineDivideFixedXYDelta(static_cast<i64>(x1 - x0), steps);
		yStep = lineDivideFixedXYDelta(static_cast<i64>(y1 - y0), steps);
		rStep = lineDivideFixedRgbDelta(colorR8(color1), r0, steps);
		gStep = lineDivideFixedRgbDelta(colorG8(color1), g0, steps);
		bStep = lineDivideFixedRgbDelta(colorB8(color1), b0, steps);
	}
	i64 currentX = lineMakeFixedXY(x0) - kGxGpuSoftwareLineSubpixelBias;
	i64 currentY = lineMakeFixedXY(y0) - (yStep < 0 ? kGxGpuSoftwareLineSubpixelBias : 0);
	i32 currentR = lineMakeFixedRgb(r0);
	i32 currentG = lineMakeFixedRgb(g0);
	i32 currentB = lineMakeFixedRgb(b0);
	for (i32 step = 0; step <= steps; step += 1) {
		const i32 x = gxGpuSigned11(static_cast<u32>(lineFixedXYToCoord(currentX)));
		const i32 y = gxGpuSigned11(static_cast<u32>(lineFixedXYToCoord(currentY)));
		if (x >= areaLeft && y >= areaTop && x < areaRight && y < areaBottom && !gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			gxGpuSoftwareWriteRenderVramPixel(
				x,
				y,
				lineFixedRgbToByte(currentR),
				lineFixedRgbToByte(currentG),
				lineFixedRgbToByte(currentB),
				ditherEnabled,
				blendEnabled,
				blendMode,
				maskBitModeWord);
		}
		currentX += xStep;
		currentY += yStep;
		currentR += rStep;
		currentG += gStep;
		currentB += bStep;
	}
}

} // namespace bmsx
