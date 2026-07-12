#pragma once

#include "machine/devices/gx/gpu_command_buffer.h"

namespace bmsx {

constexpr i32 GX_GPU_MAX_PRIMITIVE_WIDTH = 1024;
constexpr i32 GX_GPU_MAX_PRIMITIVE_HEIGHT = 512;
constexpr i32 GX_GPU_VERTEX_COORD_PERIOD = 0x800;
constexpr size_t GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES = 3u;
constexpr i32 GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS = 12;
constexpr i64 GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE = 1 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
constexpr i64 GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK = 0xfffff;
constexpr size_t GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_BITS = 4u;
constexpr size_t GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_DIGITS = 5u;
constexpr u32 GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP = 1u;
constexpr u32 GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP = 2u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_256 = 10u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_320 = 8u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_512 = 5u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_640 = 4u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_368 = 7u;
constexpr u32 GX_GPU_DISPLAY_MODE_RGB24_BIT = 0x10u;
constexpr u32 GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 0x20u;

inline i32 gxGpuSigned11(u32 value) {
	const i32 raw = static_cast<i32>(value & 0x7ffu);
	return (raw & 0x400) != 0 ? raw - 0x800 : raw;
}

inline i32 gxGpuTriangleRasterShift(i32 coord0, i32 coord1, i32 coord2) {
	const i32 minimum = coord0 < coord1 ? (coord0 < coord2 ? coord0 : coord2) : (coord1 < coord2 ? coord1 : coord2);
	return minimum < -(GX_GPU_VERTEX_COORD_PERIOD >> 1) ? GX_GPU_VERTEX_COORD_PERIOD : 0;
}

inline void gxGpuTriangleAttributePlane(
	i64* out,
	size_t outOffset,
	size_t componentCount,
	i64 determinant,
	i32 x0,
	i32 y0,
	i32 x1,
	i32 y1,
	i32 x2,
	i32 y2) {
	const i32 anchor = x1 <= x0 ? (x2 <= x1 ? 2 : 1) : (x2 < x0 ? 2 : 0);
	const i32 anchorX = anchor == 0 ? x0 : (anchor == 1 ? x1 : x2);
	const i32 anchorY = anchor == 0 ? y0 : (anchor == 1 ? y1 : y2);
	for (size_t component = 0; component < componentCount; component += 1u) {
		const i64 value0 = out[outOffset + component];
		const i64 value1 = out[outOffset + componentCount + component];
		const i64 value2 = out[outOffset + componentCount * 2u + component];
		const i64 stepXQuotient = ((value1 - value0) * static_cast<i64>(y2 - y1) - (value2 - value1) * static_cast<i64>(y1 - y0)) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE / determinant;
		const i64 stepYQuotient = (static_cast<i64>(x1 - x0) * (value2 - value1) - static_cast<i64>(x2 - x1) * (value1 - value0)) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE / determinant;
		const i64 stepXRaw = stepXQuotient & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		const i64 stepYRaw = stepYQuotient & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		const i64 stepX = (stepXRaw & 0x80000ll) != 0 ? stepXRaw - 0x100000ll : stepXRaw;
		const i64 stepY = (stepYRaw & 0x80000ll) != 0 ? stepYRaw - 0x100000ll : stepYRaw;
		const i64 anchorValue = anchor == 0 ? value0 : (anchor == 1 ? value1 : value2);
		out[outOffset + component] = (anchorValue * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE + (GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE >> 1u) - static_cast<i64>(anchorX) * stepX - static_cast<i64>(anchorY) * stepY) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		out[outOffset + componentCount + component] = stepXRaw;
		out[outOffset + componentCount * 2u + component] = stepYRaw;
	}
}

inline void gxGpuTriangleAttributePlaneInterpolants(
	f32* out,
	size_t outOffset,
	size_t vertexFloatStride,
	const i64* plane,
	size_t componentCount,
	i32 x0,
	i32 y0,
	i32 x1,
	i32 y1,
	i32 x2,
	i32 y2) {
	for (size_t component = 0; component < componentCount; component += 1u) {
		const i64 stepX = plane[componentCount + component];
		const i64 stepY = plane[componentCount * 2u + component];
		const i64 origin = (plane[component] + static_cast<i64>(x0) * stepX + static_cast<i64>(y0) * stepY) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		for (i32 vertex = 0; vertex < 3; vertex += 1) {
			const i32 x = vertex == 0 ? x0 : (vertex == 1 ? x1 : x2);
			const i32 y = vertex == 0 ? y0 : (vertex == 1 ? y1 : y2);
			const i32 localX = x - x0;
			const i32 localY = y - y0;
			const size_t offset = outOffset + static_cast<size_t>(vertex) * vertexFloatStride + component;
			for (size_t digit = 0; digit < GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_DIGITS; digit += 1u) {
				const size_t shift = digit * GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_BITS;
				out[offset + digit * componentCount] = static_cast<f32>(((origin >> shift) & 0x0fll) + ((stepX >> shift) & 0x0fll) * localX + ((stepY >> shift) & 0x0fll) * localY);
			}
		}
	}
}

inline u32 gxGpuTriangleAttributePlaneInterpolantValue(
	const f32* interpolants,
	size_t offset,
	size_t componentCount) {
	i32 carry = 0;
	u32 value = 0u;
	for (size_t digit = 0; digit < GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_DIGITS; digit += 1u) {
		const i32 sum = static_cast<i32>(interpolants[offset + digit * componentCount]) + carry;
		value |= (static_cast<u32>(sum) & 0x0fu) << (digit * GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_BITS);
		carry = sum >> GX_GPU_TRIANGLE_ATTRIBUTE_RADIX_BITS;
	}
	return value & static_cast<u32>(GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK);
}

inline i32 gxGpuVertexY(u32 word) {
	return gxGpuSigned11(word >> 16u);
}

inline u32 gxGpuDisplayStartX(u32 word) {
	return word & 0x3ffu;
}

inline u32 gxGpuDisplayModeScreenWidth(u32 displayModeWord) {
	const u32 horizontalResolution1 = displayModeWord & 0x03u;
	const bool horizontalResolution2 = (displayModeWord & 0x40u) != 0u;
	if (horizontalResolution1 == 0u) {
		return horizontalResolution2 ? 368u : 256u;
	}
	if (horizontalResolution1 == 1u) {
		return horizontalResolution2 ? 384u : 320u;
	}
	if (horizontalResolution1 == 2u) {
		return 512u;
	}
	return 640u;
}

inline u32 gxGpuDisplayModeDotClockDivider(u32 displayModeWord) {
	if ((displayModeWord & 0x40u) != 0u) {
		return GX_GPU_DOT_CLOCK_DIVIDER_368;
	}
	const u32 horizontalResolution1 = displayModeWord & 0x03u;
	if (horizontalResolution1 == 0u) {
		return GX_GPU_DOT_CLOCK_DIVIDER_256;
	}
	if (horizontalResolution1 == 1u) {
		return GX_GPU_DOT_CLOCK_DIVIDER_320;
	}
	if (horizontalResolution1 == 2u) {
		return GX_GPU_DOT_CLOCK_DIVIDER_512;
	}
	return GX_GPU_DOT_CLOCK_DIVIDER_640;
}

inline u32 gxGpuHorizontalDisplayRangeStart(u32 horizontalDisplayRangeWord) {
	return horizontalDisplayRangeWord & 0xfffu;
}

inline u32 gxGpuHorizontalDisplayRangeEnd(u32 horizontalDisplayRangeWord) {
	return (horizontalDisplayRangeWord >> 12u) & 0xfffu;
}

inline i32 gxGpuHorizontalVisibleColumns(u32 horizontalDisplayRangeWord, u32 displayModeWord) {
	const i32 rangeCycles = static_cast<i32>(gxGpuHorizontalDisplayRangeEnd(horizontalDisplayRangeWord)) - static_cast<i32>(gxGpuHorizontalDisplayRangeStart(horizontalDisplayRangeWord));
	return (((rangeCycles / static_cast<i32>(gxGpuDisplayModeDotClockDivider(displayModeWord))) + 2) & ~0x03);
}

inline u32 gxGpuVerticalDisplayRangeStart(u32 verticalDisplayRangeWord) {
	return verticalDisplayRangeWord & 0x3ffu;
}

inline u32 gxGpuVerticalDisplayRangeEnd(u32 verticalDisplayRangeWord) {
	return (verticalDisplayRangeWord >> 10u) & 0x3ffu;
}

inline i32 gxGpuVerticalVisibleLines(u32 verticalDisplayRangeWord, u32 displayModeWord) {
	const i32 lines = static_cast<i32>(gxGpuVerticalDisplayRangeEnd(verticalDisplayRangeWord)) - static_cast<i32>(gxGpuVerticalDisplayRangeStart(verticalDisplayRangeWord));
	return (displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) != 0u ? lines * 2 : lines;
}

inline i32 gxGpuDrawingOffsetY(u32 word) {
	return gxGpuSigned11(word >> 11u);
}

inline bool gxGpuCommandRawTextureEnabled(u32 opcode) {
	return (opcode & 0x01u) != 0u;
}

inline bool gxGpuCommandSemiTransparencyEnabled(u32 opcode) {
	return (opcode & 0x02u) != 0u;
}

inline bool gxGpuCommandTextureEnabled(u32 opcode) {
	return (opcode & 0x04u) != 0u;
}

inline bool gxGpuDrawModeTextureDisableEnabled(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) != 0u;
}

inline bool gxGpuCommandDrawsTexture(u32 opcode, u32 drawModeWord) {
	return gxGpuCommandTextureEnabled(opcode) && !gxGpuDrawModeTextureDisableEnabled(drawModeWord);
}

inline bool gxGpuCommandQuadPolygon(u32 opcode) {
	return (opcode & 0x08u) != 0u;
}

inline bool gxGpuCommandGouraud(u32 opcode) {
	return (opcode & 0x10u) != 0u;
}

inline u32 gxGpuCommandRectangleWidth(u32 opcode, u32 sizeWord) {
	switch (opcode & 0x18u) {
		case 0x08u:
			return 1u;
		case 0x10u:
			return 8u;
		case 0x18u:
			return 16u;
		default:
			return sizeWord & 0x3ffu;
	}
}

inline u32 gxGpuCommandRectangleHeight(u32 opcode, u32 sizeWord) {
	switch (opcode & 0x18u) {
		case 0x08u:
			return 1u;
		case 0x10u:
			return 8u;
		case 0x18u:
			return 16u;
		default:
			return (sizeWord >> 16u) & 0x1ffu;
	}
}

inline u32 gxGpuFillX(u32 xyWord) {
	return xyWord & 0x3f0u;
}

inline u32 gxGpuFillWidth(u32 sizeWord) {
	return ((sizeWord & 0x3ffu) + 0x0fu) & ~0x0fu;
}

inline u32 gxGpuFillHeight(u32 sizeWord) {
	return (sizeWord >> 16u) & 0x1ffu;
}

inline u32 gxGpuVramWrappedWidth(u32 x, u32 width) {
	const u32 edgeWidth = GX_GPU_VRAM_WIDTH - x;
	return width <= edgeWidth ? width : edgeWidth;
}

inline u32 gxGpuVramWrappedHeight(u32 y, u32 height) {
	const u32 edgeHeight = GX_GPU_VRAM_HEIGHT - y;
	return height <= edgeHeight ? height : edgeHeight;
}

inline bool gxGpuVramLogicalAreaOverlapsBounds(u32 x, u32 y, u32 width, u32 height, i32 left, i32 top, i32 right, i32 bottom) {
	u32 rowY = y & (GX_GPU_VRAM_HEIGHT - 1u);
	u32 remainingHeight = height;
	while (remainingHeight != 0u) {
		const u32 runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		u32 columnX = x & (GX_GPU_VRAM_WIDTH - 1u);
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			if (static_cast<i32>(columnX) < right && left < static_cast<i32>(columnX + runWidth) && static_cast<i32>(rowY) < bottom && top < static_cast<i32>(rowY + runHeight)) return true;
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1u);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1u);
		remainingHeight -= runHeight;
	}
	return false;
}

inline bool gxGpuSpansOverlap(u32 startA, u32 endA, u32 startB, u32 endB) {
	return startA < endB && startB < endA;
}

inline bool gxGpuVramCopyNeedsChunking(u32 sourceX, u32 sourceY, u32 targetX, u32 targetY, u32 width, u32 height) {
	return sourceX != targetX
		&& sourceY != targetY
		&& gxGpuSpansOverlap(sourceX, sourceX + width, targetX, targetX + width)
		&& gxGpuSpansOverlap(sourceY, sourceY + height, targetY, targetY + height);
}

inline u32 gxGpuVramCopyChunkHeight(u32 sourceY, u32 targetY, u32 height) {
	const u32 rowDistance = sourceY > targetY ? sourceY - targetY : targetY - sourceY;
	return rowDistance < height ? rowDistance : height;
}

inline u32 gxGpuTransferX(u32 xyWord) {
	return xyWord & 0x3ffu;
}

inline u32 gxGpuTransferY(u32 xyWord) {
	return (xyWord >> 16u) & 0x1ffu;
}

inline u32 gxGpuTransferPixelWord(u32 payloadWord, u32 pixelIndex) {
	return (pixelIndex & 1u) == 0u ? payloadWord & 0xffffu : payloadWord >> 16u;
}

inline u32 gxGpuTransferPayloadPixelCount(u32 commandWordCount) {
	return (commandWordCount - 3u) << 1u;
}

inline u32 gxGpuTransferEmittedPixelCount(u32 width, u32 height, u32 commandWordCount) {
	const u32 areaPixels = width * height;
	const u32 payloadPixels = gxGpuTransferPayloadPixelCount(commandWordCount);
	return payloadPixels < areaPixels ? payloadPixels : areaPixels;
}

inline u32 gxGpuTextureU(u32 textureWord) {
	return textureWord & 0xffu;
}

inline u32 gxGpuTextureV(u32 textureWord) {
	return (textureWord >> 8u) & 0xffu;
}

inline u32 gxGpuTextureClutBaseX(u32 textureWord) {
	return (gxGpuTextureAttribute(textureWord) & 0x3fu) << 4u;
}

inline u32 gxGpuTextureClutBaseY(u32 textureWord) {
	return (gxGpuTextureAttribute(textureWord) >> 6u) & 0x1ffu;
}

inline bool gxGpuDrawModeDitherEnabled(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_DITHER_ENABLED) != 0u;
}

inline bool gxGpuDrawModeTextureRectangleXFlip(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) != 0u;
}

inline bool gxGpuDrawModeTextureRectangleYFlip(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) != 0u;
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

inline i64 gxGpuTriangleEdgeCoverageMinimum(i64 stepX, i64 stepY) {
	return stepX > 0 || (stepX == 0 && stepY > 0) ? 0 : 1;
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
