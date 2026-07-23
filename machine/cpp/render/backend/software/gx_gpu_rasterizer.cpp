#include "render/backend/software/gx_gpu_rasterizer.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <array>

namespace bmsx {
namespace {

constexpr size_t kGxGpuTriangleUvComponents = 2u;
constexpr size_t kGxGpuTriangleColorComponents = 3u;
std::array<u32, kGxGpuTriangleUvComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> g_triangleUvPlaneScratch{};
std::array<u32, kGxGpuTriangleColorComponents * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> g_triangleColorPlaneScratch{};

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

inline i32 floorQuotient(i32 numerator, i32 denominator, i32& remainder) {
	i32 quotient = numerator / denominator;
	remainder = numerator - quotient * denominator;
	if (remainder < 0) {
		quotient -= 1;
		remainder += denominator;
	}
	return quotient;
}

struct TriangleEdgeSpan {
	i32 rowValue;
	i32 rowStep;
	i32 boundary = 0;
	i32 boundaryStep = 0;
	i32 remainder = 0;
	i32 remainderStep = 0;
	i32 denominator = 0;
	i32 boundaryKind = 0;

	TriangleEdgeSpan(i64 initialRowValue, i64 stepX, i64 stepY)
		: rowValue(static_cast<i32>(initialRowValue)),
			rowStep(static_cast<i32>(stepY)) {
		i32 numerator;
		i32 numeratorStep;
		if (stepX > 0) {
			denominator = static_cast<i32>(stepX);
			numerator = -rowValue + denominator - 1;
			numeratorStep = -rowStep;
			boundaryKind = 1;
		} else if (stepX < 0) {
			denominator = static_cast<i32>(-stepX);
			numerator = rowValue;
			numeratorStep = rowStep;
			boundaryKind = -1;
		} else {
			return;
		}
		boundary = floorQuotient(numerator, denominator, remainder);
		boundaryStep = floorQuotient(numeratorStep, denominator, remainderStep);
	}

	bool intersect(i32& firstOffset, i32& lastOffset) const {
		if (boundaryKind > 0) {
			if (boundary > firstOffset) {
				firstOffset = boundary;
			}
			return firstOffset <= lastOffset;
		}
		if (boundaryKind < 0) {
			if (boundary < lastOffset) {
				lastOffset = boundary;
			}
			return firstOffset <= lastOffset;
		}
		return rowValue >= 0;
	}

	void advance() {
		if (boundaryKind == 0) {
			rowValue += rowStep;
			return;
		}
		boundary += boundaryStep;
		remainder += remainderStep;
		if (remainder >= denominator) {
			remainder -= denominator;
			boundary += 1;
		}
	}
};

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

template<u32 TextureMode>
inline u32 sampleGxGpuSoftwareTextureWord(
	i32 u,
	i32 v,
	u32 pageX,
	u32 pageY,
	u32 textureWindowAndX,
	u32 textureWindowAndY,
	u32 textureWindowOrX,
	u32 textureWindowOrY,
	u32 clutBaseX,
	u32 clutBaseY) {
	const u32 windowedU = textureWindowCoord(u, textureWindowAndX, textureWindowOrX);
	const u32 windowedV = textureWindowCoord(v, textureWindowAndY, textureWindowOrY);
	if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE4) {
		const u32 textureWord = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(pageX + (windowedU / 4u)), static_cast<i32>(pageY + windowedV))];
		const u32 paletteIndex = (textureWord >> ((windowedU & 3u) << 2u)) & 0x0fu;
		return g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(clutBaseX + paletteIndex), static_cast<i32>(clutBaseY))];
	}
	if constexpr (TextureMode == GX_GPU_TEXTURE_MODE_PALETTE8) {
		const u32 textureWord = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(pageX + (windowedU / 2u)), static_cast<i32>(pageY + windowedV))];
		const u32 paletteIndex = (textureWord >> ((windowedU & 1u) << 3u)) & 0xffu;
		return g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(clutBaseX + paletteIndex), static_cast<i32>(clutBaseY))];
	}
	return g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(pageX + windowedU), static_cast<i32>(pageY + windowedV))];
}

template<bool RawTextureEnabled, bool SemiTransparencyEnabled>
inline void writeGxGpuSoftwareTexturedPixel(
	i32 x,
	i32 y,
	u32 colorR,
	u32 colorG,
	u32 colorB,
	u32 sampleWord,
	bool ditherEnabled,
	u32 blendMode,
	bool checkMaskBit,
	bool setMaskBit) {
	if (sampleWord == 0u) {
		return;
	}
	u32 r5 = sampleWord & 0x1fu;
	u32 g5 = (sampleWord >> 5u) & 0x1fu;
	u32 b5 = (sampleWord >> 10u) & 0x1fu;
	if constexpr (!RawTextureEnabled) {
		const i32 ditherOffset = ditherEnabled ? gxGpuSoftwareDitherOffset(x, y) : 0;
		r5 = gxGpuSoftwareTextureModulationChannel5(r5, colorR, ditherOffset);
		g5 = gxGpuSoftwareTextureModulationChannel5(g5, colorG, ditherOffset);
		b5 = gxGpuSoftwareTextureModulationChannel5(b5, colorB, ditherOffset);
	}
	const u32 sampleMaskBit = sampleWord & 0x8000u;
	const bool blendEnabled = SemiTransparencyEnabled && sampleMaskBit != 0u;
	gxGpuSoftwareWriteRenderVramPixel5(x, y, r5, g5, b5, blendEnabled, blendMode, checkMaskBit, setMaskBit, sampleMaskBit);
}

template<u32 TextureMode, typename Draw>
inline void dispatchGxGpuSoftwareTextureFlags(
	bool rawTextureEnabled,
	bool semiTransparencyEnabled,
	Draw& draw) {
	if (rawTextureEnabled) {
		if (semiTransparencyEnabled) {
			draw.template operator()<TextureMode, true, true>();
		} else {
			draw.template operator()<TextureMode, true, false>();
		}
	} else if (semiTransparencyEnabled) {
		draw.template operator()<TextureMode, false, true>();
	} else {
		draw.template operator()<TextureMode, false, false>();
	}
}

template<typename Draw>
inline void dispatchGxGpuSoftwareTextureState(
	u32 textureMode,
	bool rawTextureEnabled,
	bool semiTransparencyEnabled,
	Draw& draw) {
	switch (textureMode) {
		case GX_GPU_TEXTURE_MODE_PALETTE4:
			dispatchGxGpuSoftwareTextureFlags<GX_GPU_TEXTURE_MODE_PALETTE4>(
				rawTextureEnabled, semiTransparencyEnabled, draw);
			return;
		case GX_GPU_TEXTURE_MODE_PALETTE8:
			dispatchGxGpuSoftwareTextureFlags<GX_GPU_TEXTURE_MODE_PALETTE8>(
				rawTextureEnabled, semiTransparencyEnabled, draw);
			return;
		default:
			dispatchGxGpuSoftwareTextureFlags<GX_GPU_TEXTURE_MODE_DIRECT16>(
				rawTextureEnabled, semiTransparencyEnabled, draw);
			return;
	}
}

} // namespace

void drawGxGpuSoftwareRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 width, u32 height, u32 colorWord) {
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
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
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const i32 skippedLineParity = static_cast<i32>(commandBuffer.commandSkippedLineParity[commandIndex]);
	const u32 r8 = colorR8(colorWord);
	const u32 g8 = colorG8(colorWord);
	const u32 b8 = colorB8(colorWord);
	for (i32 y = top; y < bottom; y += 1) {
		if ((y & 1) == skippedLineParity) {
			continue;
		}
		for (i32 x = left; x < right; x += 1) {
			gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, false, blendEnabled, blendMode, checkMaskBit, setMaskBit);
		}
	}
}

namespace {

template<bool InterpolatesColor, bool DitherEnabled, bool SemiTransparencyEnabled>
void drawGxGpuSoftwareTriangleImpl(
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	u32 drawModeWord,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 x2,
	i32 y2,
	u32 color2) {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return;
	}
	const i32 xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const i32 yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	i64 area = edgeValue(x0, y0, x1, y1, x2, y2);
	if (area == 0) {
		return;
	}
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
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
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const i32 skippedLineParity = static_cast<i32>(commandBuffer.commandSkippedLineParity[commandIndex]);
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
	u32 rStepX = 0u;
	u32 gStepX = 0u;
	u32 bStepX = 0u;
	u32 rStepY = 0u;
	u32 gStepY = 0u;
	u32 bStepY = 0u;
	u32 rowR = 0u;
	u32 rowG = 0u;
	u32 rowB = 0u;
	if constexpr (InterpolatesColor) {
		g_triangleColorPlaneScratch[0] = r0;
		g_triangleColorPlaneScratch[1] = g0;
		g_triangleColorPlaneScratch[2] = b0;
		g_triangleColorPlaneScratch[3] = colorR8(color1);
		g_triangleColorPlaneScratch[4] = colorG8(color1);
		g_triangleColorPlaneScratch[5] = colorB8(color1);
		g_triangleColorPlaneScratch[6] = colorR8(color2);
		g_triangleColorPlaneScratch[7] = colorG8(color2);
		g_triangleColorPlaneScratch[8] = colorB8(color2);
		const i64 determinant = -area * edgeSign;
		gxGpuTriangleAttributePlane(g_triangleColorPlaneScratch.data(), 0u, kGxGpuTriangleColorComponents, determinant, x0, y0, x1, y1, x2, y2);
		rStepX = g_triangleColorPlaneScratch[3];
		gStepX = g_triangleColorPlaneScratch[4];
		bStepX = g_triangleColorPlaneScratch[5];
		rStepY = g_triangleColorPlaneScratch[6];
		gStepY = g_triangleColorPlaneScratch[7];
		bStepY = g_triangleColorPlaneScratch[8];
		rowR = g_triangleColorPlaneScratch[0] + static_cast<u32>(left) * rStepX + static_cast<u32>(top) * rStepY;
		rowG = g_triangleColorPlaneScratch[1] + static_cast<u32>(left) * gStepX + static_cast<u32>(top) * gStepY;
		rowB = g_triangleColorPlaneScratch[2] + static_cast<u32>(left) * bStepX + static_cast<u32>(top) * bStepY;
	}
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	TriangleEdgeSpan edge0(rowW0, edge0StepX, edge0StepY);
	TriangleEdgeSpan edge1(rowW1, edge1StepX, edge1StepY);
	TriangleEdgeSpan edge2(rowW2, edge2StepX, edge2StepY);
	for (i32 y = top; y < bottomExclusive; y += 1) {
		if ((y & 1) != skippedLineParity) {
			i32 firstOffset = 0;
			i32 lastOffset = rightExclusive - left - 1;
			if (edge0.intersect(firstOffset, lastOffset)
				&& edge1.intersect(firstOffset, lastOffset)
				&& edge2.intersect(firstOffset, lastOffset)) {
				u32 rFixed = rowR + static_cast<u32>(firstOffset) * rStepX;
				u32 gFixed = rowG + static_cast<u32>(firstOffset) * gStepX;
				u32 bFixed = rowB + static_cast<u32>(firstOffset) * bStepX;
				const i32 spanEnd = left + lastOffset;
				for (i32 x = left + firstOffset; x <= spanEnd; x += 1) {
					const u32 r8 = InterpolatesColor ? (rFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu : r0;
					const u32 g8 = InterpolatesColor ? (gFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu : g0;
					const u32 b8 = InterpolatesColor ? (bFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu : b0;
					gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, DitherEnabled, SemiTransparencyEnabled, blendMode, checkMaskBit, setMaskBit);
					if constexpr (InterpolatesColor) {
						rFixed += rStepX;
						gFixed += gStepX;
						bFixed += bStepX;
					}
				}
			}
		}
		edge0.advance();
		edge1.advance();
		edge2.advance();
		if constexpr (InterpolatesColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
	}
}

} // namespace

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
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	auto draw = [&]<bool InterpolatesColor, bool DitherEnabled, bool SemiTransparencyEnabled>() {
		drawGxGpuSoftwareTriangleImpl<InterpolatesColor, DitherEnabled, SemiTransparencyEnabled>(
			commandBuffer,
			commandIndex,
			drawModeWord,
			x0,
			y0,
			color0,
			x1,
			y1,
			color1,
			x2,
			y2,
			color2);
	};
	const bool interpolatesColor = color0 != color1 || color0 != color2;
	if (gxGpuCommandSemiTransparencyEnabled(opcode)) {
		if (ditherEnabled) {
			if (interpolatesColor) {
				draw.template operator()<true, true, true>();
			} else {
				draw.template operator()<false, true, true>();
			}
		} else if (interpolatesColor) {
			draw.template operator()<true, false, true>();
		} else {
			draw.template operator()<false, false, true>();
		}
	} else if (ditherEnabled) {
		if (interpolatesColor) {
			draw.template operator()<true, true, false>();
		} else {
			draw.template operator()<false, true, false>();
		}
	} else if (interpolatesColor) {
		draw.template operator()<true, false, false>();
	} else {
		draw.template operator()<false, false, false>();
	}
}

namespace {

template<u32 TextureMode, bool RawTextureEnabled, bool SemiTransparencyEnabled, bool InterpolatesColor, bool DitherEnabled>
void drawGxGpuSoftwareTexturedTriangleImpl(
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	u32 drawModeWord,
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
	i32 v2) {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return;
	}
	const i32 xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const i32 yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	i64 area = edgeValue(x0, y0, x1, y1, x2, y2);
	if (area == 0) {
		return;
	}
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
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
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 textureWord0 = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const u32 textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const u32 textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const u32 textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const u32 textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const u32 clutBaseX = gxGpuTextureClutBaseX(textureWord0);
	const u32 clutBaseY = gxGpuTextureClutBaseY(textureWord0, vramYAddressExtensionWord);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const i32 skippedLineParity = static_cast<i32>(commandBuffer.commandSkippedLineParity[commandIndex]);
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
	u32 rStepX = 0u;
	u32 gStepX = 0u;
	u32 bStepX = 0u;
	u32 rStepY = 0u;
	u32 gStepY = 0u;
	u32 bStepY = 0u;
	u32 rowR = 0u;
	u32 rowG = 0u;
	u32 rowB = 0u;
	const i64 determinant = -area * edgeSign;
	if constexpr (InterpolatesColor) {
		g_triangleColorPlaneScratch[0] = r0;
		g_triangleColorPlaneScratch[1] = g0;
		g_triangleColorPlaneScratch[2] = b0;
		g_triangleColorPlaneScratch[3] = colorR8(color1);
		g_triangleColorPlaneScratch[4] = colorG8(color1);
		g_triangleColorPlaneScratch[5] = colorB8(color1);
		g_triangleColorPlaneScratch[6] = colorR8(color2);
		g_triangleColorPlaneScratch[7] = colorG8(color2);
		g_triangleColorPlaneScratch[8] = colorB8(color2);
		gxGpuTriangleAttributePlane(g_triangleColorPlaneScratch.data(), 0u, kGxGpuTriangleColorComponents, determinant, x0, y0, x1, y1, x2, y2);
		rStepX = g_triangleColorPlaneScratch[3];
		gStepX = g_triangleColorPlaneScratch[4];
		bStepX = g_triangleColorPlaneScratch[5];
		rStepY = g_triangleColorPlaneScratch[6];
		gStepY = g_triangleColorPlaneScratch[7];
		bStepY = g_triangleColorPlaneScratch[8];
		rowR = g_triangleColorPlaneScratch[0] + static_cast<u32>(left) * rStepX + static_cast<u32>(top) * rStepY;
		rowG = g_triangleColorPlaneScratch[1] + static_cast<u32>(left) * gStepX + static_cast<u32>(top) * gStepY;
		rowB = g_triangleColorPlaneScratch[2] + static_cast<u32>(left) * bStepX + static_cast<u32>(top) * bStepY;
	}
	g_triangleUvPlaneScratch[0] = u0;
	g_triangleUvPlaneScratch[1] = v0;
	g_triangleUvPlaneScratch[2] = u1;
	g_triangleUvPlaneScratch[3] = v1;
	g_triangleUvPlaneScratch[4] = u2;
	g_triangleUvPlaneScratch[5] = v2;
	gxGpuTriangleAttributePlane(g_triangleUvPlaneScratch.data(), 0u, kGxGpuTriangleUvComponents, determinant, x0, y0, x1, y1, x2, y2);
	const u32 uStepX = g_triangleUvPlaneScratch[2];
	const u32 vStepX = g_triangleUvPlaneScratch[3];
	const u32 uStepY = g_triangleUvPlaneScratch[4];
	const u32 vStepY = g_triangleUvPlaneScratch[5];
	u32 rowU = g_triangleUvPlaneScratch[0] + static_cast<u32>(left) * uStepX + static_cast<u32>(top) * uStepY;
	u32 rowV = g_triangleUvPlaneScratch[1] + static_cast<u32>(left) * vStepX + static_cast<u32>(top) * vStepY;
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	TriangleEdgeSpan edge0(rowW0, edge0StepX, edge0StepY);
	TriangleEdgeSpan edge1(rowW1, edge1StepX, edge1StepY);
	TriangleEdgeSpan edge2(rowW2, edge2StepX, edge2StepY);
	for (i32 y = top; y < bottomExclusive; y += 1) {
		if ((y & 1) != skippedLineParity) {
			i32 firstOffset = 0;
			i32 lastOffset = rightExclusive - left - 1;
			if (edge0.intersect(firstOffset, lastOffset)
				&& edge1.intersect(firstOffset, lastOffset)
				&& edge2.intersect(firstOffset, lastOffset)) {
				u32 rFixed = rowR + static_cast<u32>(firstOffset) * rStepX;
				u32 gFixed = rowG + static_cast<u32>(firstOffset) * gStepX;
				u32 bFixed = rowB + static_cast<u32>(firstOffset) * bStepX;
				u32 uFixed = rowU + static_cast<u32>(firstOffset) * uStepX;
				u32 vFixed = rowV + static_cast<u32>(firstOffset) * vStepX;
				const i32 spanEnd = left + lastOffset;
				for (i32 x = left + firstOffset; x <= spanEnd; x += 1) {
					const u32 r8 = InterpolatesColor ? (rFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu : r0;
					const u32 g8 = InterpolatesColor ? (gFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu : g0;
					const u32 b8 = InterpolatesColor ? (bFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu : b0;
					const i32 u = static_cast<i32>((uFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu);
					const i32 v = static_cast<i32>((vFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu);
					const u32 sampleWord = sampleGxGpuSoftwareTextureWord<TextureMode>(
						u,
						v,
						pageX,
						pageY,
						textureWindowAndX,
						textureWindowAndY,
						textureWindowOrX,
						textureWindowOrY,
						clutBaseX,
						clutBaseY);
					writeGxGpuSoftwareTexturedPixel<RawTextureEnabled, SemiTransparencyEnabled>(
						x,
						y,
						r8,
						g8,
						b8,
						sampleWord,
						DitherEnabled,
						blendMode,
						checkMaskBit,
						setMaskBit);
					if constexpr (InterpolatesColor) {
						rFixed += rStepX;
						gFixed += gStepX;
						bFixed += bStepX;
					}
					uFixed += uStepX;
					vFixed += vStepX;
				}
			}
		}
		edge0.advance();
		edge1.advance();
		edge2.advance();
		if constexpr (InterpolatesColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
		rowU += uStepY;
		rowV += vStepY;
	}
}

template<u32 TextureMode, bool RawTextureEnabled, bool SemiTransparencyEnabled>
void drawGxGpuSoftwareTexturedRectangleImpl(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, u32 drawModeWord, i32 x0, i32 y0, u32 width, u32 height, u32 colorWord, u32 textureWord) {
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 left = x0 > areaLeft ? x0 : areaLeft;
	const i32 top = y0 > areaTop ? y0 : areaTop;
	const i32 rectangleRight = x0 + static_cast<i32>(width);
	const i32 rectangleBottom = y0 + static_cast<i32>(height);
	const i32 right = rectangleRight < areaRight ? rectangleRight : areaRight;
	const i32 bottom = rectangleBottom < areaBottom ? rectangleBottom : areaBottom;
	const bool xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const bool yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const i32 baseU = static_cast<i32>(gxGpuTextureU(textureWord));
	const i32 baseV = static_cast<i32>(gxGpuTextureV(textureWord));
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const u32 pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const u32 pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const u32 textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const u32 textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const u32 textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const u32 textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const u32 clutBaseX = gxGpuTextureClutBaseX(textureWord);
	const u32 clutBaseY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const i32 skippedLineParity = static_cast<i32>(commandBuffer.commandSkippedLineParity[commandIndex]);
	const u32 r8 = colorR8(colorWord);
	const u32 g8 = colorG8(colorWord);
	const u32 b8 = colorB8(colorWord);
	const i32 uStep = xFlip ? -1 : 1;
	const i32 vStep = yFlip ? -1 : 1;
	const i32 firstU = baseU + (left - x0) * uStep;
	i32 v = baseV + (top - y0) * vStep;
	for (i32 y = top; y < bottom; y += 1, v += vStep) {
		if ((y & 1) == skippedLineParity) {
			continue;
		}
		i32 u = firstU;
		for (i32 x = left; x < right; x += 1, u += uStep) {
			const u32 sampleWord = sampleGxGpuSoftwareTextureWord<TextureMode>(
				u,
				v,
				pageX,
				pageY,
				textureWindowAndX,
				textureWindowAndY,
				textureWindowOrX,
				textureWindowOrY,
				clutBaseX,
				clutBaseY);
			writeGxGpuSoftwareTexturedPixel<RawTextureEnabled, SemiTransparencyEnabled>(
				x,
				y,
				r8,
				g8,
				b8,
				sampleWord,
				false,
				blendMode,
				checkMaskBit,
				setMaskBit);
		}
	}
}

} // namespace

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
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	auto draw = [&]<u32 TextureMode, bool RawTextureEnabled, bool SemiTransparencyEnabled>() {
		auto drawTriangle = [&]<bool InterpolatesColor, bool DitherEnabled>() {
			drawGxGpuSoftwareTexturedTriangleImpl<
				TextureMode,
				RawTextureEnabled,
				SemiTransparencyEnabled,
				InterpolatesColor,
				DitherEnabled>(
				commandBuffer,
				commandIndex,
				drawModeWord,
				x0,
				y0,
				color0,
				u0,
				v0,
				x1,
				y1,
				color1,
				u1,
				v1,
				x2,
				y2,
				color2,
				u2,
				v2);
		};
		if constexpr (RawTextureEnabled) {
			drawTriangle.template operator()<false, false>();
		} else if (ditherEnabled) {
			if (color0 == color1 && color0 == color2) {
				drawTriangle.template operator()<false, true>();
			} else {
				drawTriangle.template operator()<true, true>();
			}
		} else if (color0 == color1 && color0 == color2) {
			drawTriangle.template operator()<false, false>();
		} else {
			drawTriangle.template operator()<true, false>();
		}
	};
	dispatchGxGpuSoftwareTextureState(
		gxGpuDrawModeTextureMode(drawModeWord),
		gxGpuCommandRawTextureEnabled(opcode),
		gxGpuCommandSemiTransparencyEnabled(opcode),
		draw);
}

void drawGxGpuSoftwareTexturedRectangle(
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 width,
	u32 height,
	u32 colorWord,
	u32 textureWord) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	auto draw = [&]<u32 TextureMode, bool RawTextureEnabled, bool SemiTransparencyEnabled>() {
		drawGxGpuSoftwareTexturedRectangleImpl<
			TextureMode,
			RawTextureEnabled,
			SemiTransparencyEnabled>(
			commandBuffer,
			commandIndex,
			drawModeWord,
			x0,
			y0,
			width,
			height,
			colorWord,
			textureWord);
	};
	dispatchGxGpuSoftwareTextureState(
		gxGpuDrawModeTextureMode(drawModeWord),
		gxGpuCommandRawTextureEnabled(opcode),
		gxGpuCommandSemiTransparencyEnabled(opcode),
		draw);
}

void drawGxGpuSoftwareLineSegment(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 color0, i32 x1, i32 y1, u32 color1) {
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		return;
	}
	const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord));
	const i32 absDx = absI32(x1 - x0);
	const i32 absDy = absI32(y1 - y0);
	const i32 steps = absDx >= absDy ? absDx : absDy;
	if (x0 > x1) {
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
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const i32 skippedLineParity = static_cast<i32>(commandBuffer.commandSkippedLineParity[commandIndex]);
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
		if (x >= areaLeft && y >= areaTop && x < areaRight && y < areaBottom && (y & 1) != skippedLineParity) {
			gxGpuSoftwareWriteRenderVramPixel(
				x,
				y,
				lineFixedRgbToByte(currentR),
				lineFixedRgbToByte(currentG),
				lineFixedRgbToByte(currentB),
				ditherEnabled,
				blendEnabled,
				blendMode,
				checkMaskBit,
				setMaskBit);
		}
		currentX += xStep;
		currentY += yStep;
		currentR += rStep;
		currentG += gStep;
		currentB += bStep;
	}
}

} // namespace bmsx
