#include "render/backend/software/gx_gpu_rasterizer.h"

#include "machine/devices/gx/gpu_command_storage.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_span.h"
#include "render/backend/software/gx_gpu_texels.h"
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

// Latch source reads at the primitive boundary; this is not a PSX cache model.
inline u32 latchGxGpuSoftwareTextureReads(GxGpuSoftwareState& software,
	u32 pageX, u32 pageY, u32 textureMode, u32 clutBaseX, u32 clutBaseY,
	i32 left, i32 top, i32 right, i32 bottom, u32 vramYAddressExtensionWord,
	u32 rowU, u32 rowV, u32 uStepX, u32 uStepY, u32 vStepX, u32 vStepY,
	u32 andX, u32 orX, u32 andY, u32 orY) {
	const u32 rowMask = static_cast<u32>(software.vramWordMask >> 10u);
	const u32 shift = textureMode == GX_GPU_TEXTURE_MODE_PALETTE4 ? 2u : textureMode == GX_GPU_TEXTURE_MODE_PALETTE8 ? 1u : 0u;
	const u32 pageWidth = 256u >> shift;
	u32 latched = 0u;
	if (gxGpuVramLogicalAreaOverlapsBounds(pageX, pageY, pageWidth, 256u, left, top, right, bottom, vramYAddressExtensionWord, rowMask)) {
		auto& bounds = software.textureBoundsScratch;
		gxGpuTextureAxisBounds(bounds, 0u, rowU, uStepX, uStepY, right-left, bottom-top, andX, orX);
		gxGpuTextureAxisBounds(bounds, 2u, rowV, vStepX, vStepY, right-left, bottom-top, andY, orY);
		const u32 sourceX = pageX + (static_cast<u32>(bounds[0]) >> shift);
		const u32 sourceY = pageY + static_cast<u32>(bounds[2]);
		const u32 sourceWidth = (static_cast<u32>(bounds[1] - 1) >> shift) + 1u - (static_cast<u32>(bounds[0]) >> shift);
		const u32 sourceHeight = static_cast<u32>(bounds[3] - bounds[2]);
		if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, left, top, right, bottom, vramYAddressExtensionWord, rowMask)) {
			for (u32 y = 0u; y < sourceHeight; ++y) for (u32 x = 0u; x < sourceWidth; ++x) {
				const size_t index = gxGpuSoftwareVramIndex(software, static_cast<i32>(sourceX+x), static_cast<i32>(sourceY+y));
				software.textureLatchScratch[index] = software.vram[index];
			}
			latched |= 1u;
		}
	}
	const u32 clutWidth = textureMode == GX_GPU_TEXTURE_MODE_PALETTE4 ? 16u : textureMode == GX_GPU_TEXTURE_MODE_PALETTE8 ? 256u : 0u;
	if (clutWidth != 0u && gxGpuVramLogicalAreaOverlapsBounds(clutBaseX, clutBaseY, clutWidth, 1u, left, top, right, bottom, vramYAddressExtensionWord, rowMask)) {
		for (u32 x = 0u; x < clutWidth; ++x) {
			const size_t index = gxGpuSoftwareVramIndex(software, static_cast<i32>(clutBaseX+x), static_cast<i32>(clutBaseY));
			software.textureLatchScratch[index] = software.vram[index];
		}
		latched |= 2u;
	}
	return latched;
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

void drawGxGpuSoftwareRectangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 width,
	u32 height,
	u32 colorWord) {
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
	const GxGpuSoftwareColorSpan span{
		colorR8(colorWord) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
		colorG8(colorWord) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
		colorB8(colorWord) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
		0u, 0u, 0u, blendMode, checkMaskBit, setMaskBit};
	for (i32 y = top; y < bottom; y += 1) {
		if ((y & 1) == skippedLineParity) {
			continue;
		}
		if (blendEnabled) {
			gxGpuSoftwareWriteColorSpan<false, false, true>(software, left, y, right - left, span);
		} else {
			gxGpuSoftwareWriteColorSpan<false, false, false>(software, left, y, right - left, span);
		}
	}
}

namespace {

template<bool InterpolatesColor, bool DitherEnabled, bool SemiTransparencyEnabled>
void drawGxGpuSoftwareTriangleImpl(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
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
	auto& colorPlaneScratch = software.triangleColorPlaneScratch;
	if constexpr (InterpolatesColor) {
		colorPlaneScratch[0] = r0;
		colorPlaneScratch[1] = g0;
		colorPlaneScratch[2] = b0;
		colorPlaneScratch[3] = colorR8(color1);
		colorPlaneScratch[4] = colorG8(color1);
		colorPlaneScratch[5] = colorB8(color1);
		colorPlaneScratch[6] = colorR8(color2);
		colorPlaneScratch[7] = colorG8(color2);
		colorPlaneScratch[8] = colorB8(color2);
		const i64 determinant = -area * edgeSign;
		gxGpuTriangleAttributePlane(colorPlaneScratch.data(), 0u, GX_GPU_TRIANGLE_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
		rStepX = colorPlaneScratch[3];
		gStepX = colorPlaneScratch[4];
		bStepX = colorPlaneScratch[5];
		rStepY = colorPlaneScratch[6];
		gStepY = colorPlaneScratch[7];
		bStepY = colorPlaneScratch[8];
		rowR = colorPlaneScratch[0] + static_cast<u32>(left) * rStepX + static_cast<u32>(top) * rStepY;
		rowG = colorPlaneScratch[1] + static_cast<u32>(left) * gStepX + static_cast<u32>(top) * gStepY;
		rowB = colorPlaneScratch[2] + static_cast<u32>(left) * bStepX + static_cast<u32>(top) * bStepY;
	}
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	auto& edge0 = software.triangleEdge0;
	auto& edge1 = software.triangleEdge1;
	auto& edge2 = software.triangleEdge2;
	auto& spanBounds = software.triangleSpanBounds;
	edge0.initialize(rowW0, edge0StepX, edge0StepY);
	edge1.initialize(rowW1, edge1StepX, edge1StepY);
	edge2.initialize(rowW2, edge2StepX, edge2StepY);
	for (i32 y = top; y < bottomExclusive; y += 1) {
		if ((y & 1) != skippedLineParity) {
			spanBounds[0] = 0;
			spanBounds[1] = rightExclusive - left - 1;
			if (edge0.intersect(spanBounds[0], spanBounds[1])
				&& edge1.intersect(spanBounds[0], spanBounds[1])
				&& edge2.intersect(spanBounds[0], spanBounds[1])) {
				const i32 firstOffset = spanBounds[0];
				const GxGpuSoftwareColorSpan span = InterpolatesColor
					? GxGpuSoftwareColorSpan{
						rowR + static_cast<u32>(firstOffset) * rStepX,
						rowG + static_cast<u32>(firstOffset) * gStepX,
						rowB + static_cast<u32>(firstOffset) * bStepX,
						rStepX, gStepX, bStepX, blendMode, checkMaskBit, setMaskBit}
					: GxGpuSoftwareColorSpan{
						r0 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
						g0 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
						b0 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
						0u, 0u, 0u, blendMode, checkMaskBit, setMaskBit};
				gxGpuSoftwareWriteColorSpan<InterpolatesColor, DitherEnabled, SemiTransparencyEnabled>(
					software, left + firstOffset, y, spanBounds[1] - firstOffset + 1, span);
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
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
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
			software,
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
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
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
	auto& colorPlaneScratch = software.triangleColorPlaneScratch;
	const i64 determinant = -area * edgeSign;
	if constexpr (InterpolatesColor) {
		colorPlaneScratch[0] = r0;
		colorPlaneScratch[1] = g0;
		colorPlaneScratch[2] = b0;
		colorPlaneScratch[3] = colorR8(color1);
		colorPlaneScratch[4] = colorG8(color1);
		colorPlaneScratch[5] = colorB8(color1);
		colorPlaneScratch[6] = colorR8(color2);
		colorPlaneScratch[7] = colorG8(color2);
		colorPlaneScratch[8] = colorB8(color2);
		gxGpuTriangleAttributePlane(colorPlaneScratch.data(), 0u, GX_GPU_TRIANGLE_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
		rStepX = colorPlaneScratch[3];
		gStepX = colorPlaneScratch[4];
		bStepX = colorPlaneScratch[5];
		rStepY = colorPlaneScratch[6];
		gStepY = colorPlaneScratch[7];
		bStepY = colorPlaneScratch[8];
		rowR = colorPlaneScratch[0] + static_cast<u32>(left) * rStepX + static_cast<u32>(top) * rStepY;
		rowG = colorPlaneScratch[1] + static_cast<u32>(left) * gStepX + static_cast<u32>(top) * gStepY;
		rowB = colorPlaneScratch[2] + static_cast<u32>(left) * bStepX + static_cast<u32>(top) * bStepY;
	}
	auto& uvPlaneScratch = software.triangleUvPlaneScratch;
	uvPlaneScratch[0] = static_cast<u32>(u0);
	uvPlaneScratch[1] = static_cast<u32>(v0);
	uvPlaneScratch[2] = static_cast<u32>(u1);
	uvPlaneScratch[3] = static_cast<u32>(v1);
	uvPlaneScratch[4] = static_cast<u32>(u2);
	uvPlaneScratch[5] = static_cast<u32>(v2);
	gxGpuTriangleAttributePlane(uvPlaneScratch.data(), 0u, GX_GPU_TRIANGLE_UV_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
	const u32 uStepX = uvPlaneScratch[2];
	const u32 vStepX = uvPlaneScratch[3];
	const u32 uStepY = uvPlaneScratch[4];
	const u32 vStepY = uvPlaneScratch[5];
	u32 rowU = uvPlaneScratch[0] + static_cast<u32>(left) * uStepX + static_cast<u32>(top) * uStepY;
	u32 rowV = uvPlaneScratch[1] + static_cast<u32>(left) * vStepX + static_cast<u32>(top) * vStepY;
	const u32 latched = latchGxGpuSoftwareTextureReads(software, pageX, pageY, TextureMode, clutBaseX, clutBaseY, left, top, rightExclusive, bottomExclusive, vramYAddressExtensionWord, rowU, rowV, uStepX, uStepY, vStepX, vStepY, textureWindowAndX, textureWindowOrX, textureWindowAndY, textureWindowOrY);
	const u16* textureWords = (latched & 1u) != 0u ? software.textureLatchScratch.data() : software.vram.data();
	const u16* clutWords = (latched & 2u) != 0u ? software.textureLatchScratch.data() : software.vram.data();
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	auto& edge0 = software.triangleEdge0;
	auto& edge1 = software.triangleEdge1;
	auto& edge2 = software.triangleEdge2;
	auto& spanBounds = software.triangleSpanBounds;
	edge0.initialize(rowW0, edge0StepX, edge0StepY);
	edge1.initialize(rowW1, edge1StepX, edge1StepY);
	edge2.initialize(rowW2, edge2StepX, edge2StepY);
	for (i32 y = top; y < bottomExclusive; y += 1) {
		if ((y & 1) != skippedLineParity) {
			spanBounds[0] = 0;
			spanBounds[1] = rightExclusive - left - 1;
			if (edge0.intersect(spanBounds[0], spanBounds[1])
				&& edge1.intersect(spanBounds[0], spanBounds[1])
				&& edge2.intersect(spanBounds[0], spanBounds[1])) {
				const i32 firstOffset = spanBounds[0];
				const GxGpuSoftwareColorSpan span = InterpolatesColor
					? GxGpuSoftwareColorSpan{
						rowR + static_cast<u32>(firstOffset) * rStepX,
						rowG + static_cast<u32>(firstOffset) * gStepX,
						rowB + static_cast<u32>(firstOffset) * bStepX,
						rStepX, gStepX, bStepX, blendMode, checkMaskBit, setMaskBit}
					: GxGpuSoftwareColorSpan{
						r0 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
						g0 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
						b0 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
						0u, 0u, 0u, blendMode, checkMaskBit, setMaskBit};
				u32 uFixed = rowU + static_cast<u32>(firstOffset) * uStepX;
				u32 vFixed = rowV + static_cast<u32>(firstOffset) * vStepX;
				auto sampler = [&]() {
					const u32 sampleWord = sampleGxGpuSoftwareTextureWord<TextureMode>(
						software, textureWords, clutWords,
						static_cast<i32>((uFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu),
						static_cast<i32>((vFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu),
						pageX, pageY, textureWindowAndX, textureWindowAndY, textureWindowOrX, textureWindowOrY,
						clutBaseX, clutBaseY);
					uFixed += uStepX;
					vFixed += vStepX;
					return sampleWord;
				};
				gxGpuSoftwareWriteTexturedSpan<RawTextureEnabled, SemiTransparencyEnabled, InterpolatesColor, DitherEnabled>(
					software, left + firstOffset, y, spanBounds[1] - firstOffset + 1, span, sampler);
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
void drawGxGpuSoftwareTexturedRectangleImpl(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex,
	u32 drawModeWord,
	i32 x0,
	i32 y0,
	u32 width,
	u32 height,
	u32 colorWord,
	u32 textureWord) {
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
	const GxGpuSoftwareColorSpan span{
		colorR8(colorWord) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
		colorG8(colorWord) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
		colorB8(colorWord) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
		0u, 0u, 0u, blendMode, checkMaskBit, setMaskBit};
	const i32 uStep = xFlip ? -1 : 1;
	const i32 vStep = yFlip ? -1 : 1;
	const i32 firstU = baseU + (left - x0) * uStep;
	i32 v = baseV + (top - y0) * vStep;
	const u32 latched = latchGxGpuSoftwareTextureReads(software, pageX, pageY, TextureMode, clutBaseX, clutBaseY, left, top, right, bottom, vramYAddressExtensionWord,
		static_cast<u32>(firstU) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE, static_cast<u32>(v) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE,
		static_cast<u32>(uStep) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE, 0u, 0u, static_cast<u32>(vStep) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE,
		textureWindowAndX, textureWindowOrX, textureWindowAndY, textureWindowOrY);
	const GxGpuSoftwareRectangleTexture<TextureMode> texture(software, GxGpuSoftwareTextureSource{
		(latched & 1u) != 0u ? software.textureLatchScratch.data() : software.vram.data(),
		(latched & 2u) != 0u ? software.textureLatchScratch.data() : software.vram.data(),
		pageX, pageY, textureWindowAndX, textureWindowAndY, textureWindowOrX, textureWindowOrY, clutBaseX, clutBaseY}, uStep);
	for (i32 y = top; y < bottom; y += 1, v += vStep) {
		if ((y & 1) == skippedLineParity) {
			continue;
		}
		GxGpuSoftwareRectangleTexels<TextureMode> texels(texture, firstU, v);
		gxGpuSoftwareWriteTexturedSpan<RawTextureEnabled, SemiTransparencyEnabled, false, false>(
			software, left, y, right - left, span, texels);
	}
}

} // namespace

void drawGxGpuSoftwareTexturedTriangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
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
				software,
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
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
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
			software,
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

void drawGxGpuSoftwareLineSegment(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
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
				software,
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
