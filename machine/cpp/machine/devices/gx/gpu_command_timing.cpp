#include "machine/devices/gx/gpu_command_timing.h"

namespace bmsx {
namespace {

i64 lineTicks(i32 x0, i32 y0, i32 x1, i32 y1, u32 drawingAreaTopLeftWord, u32 drawingAreaBottomRightWord, u8 interlacedRenderWord) {
	const i32 sourceLeft = x0 < x1 ? x0 : x1;
	const i32 sourceRight = x0 > x1 ? x0 : x1;
	const i32 sourceTop = y0 < y1 ? y0 : y1;
	const i32 sourceBottom = y0 > y1 ? y0 : y1;
	if (sourceRight - sourceLeft + 1 > 1024 || sourceBottom - sourceTop + 1 > 512) return 0;
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 left = sourceLeft > areaLeft ? sourceLeft : areaLeft;
	const i32 top = sourceTop > areaTop ? sourceTop : areaTop;
	const i32 right = sourceRight + 1 < areaRight ? sourceRight + 1 : areaRight;
	const i32 bottom = sourceBottom + 1 < areaBottom ? sourceBottom + 1 : areaBottom;
	if (left >= right || top >= bottom) return 0;
	const i32 width = right - left;
	i32 height = bottom - top;
	if ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) != 0u) {
		height >>= 1;
		if (height == 0) height = 1;
	}
	return width > height ? width : height;
}

i64 triangleTicks(
	i32 x0,
	i32 y0,
	i32 x1,
	i32 y1,
	i32 x2,
	i32 y2,
	bool textured,
	bool semiTransparent,
	u32 drawingAreaTopLeftWord,
	u32 drawingAreaBottomRightWord,
	u32 maskBitModeWord,
	u8 interlacedRenderWord) {
	const i32 min12X = x1 < x2 ? x1 : x2;
	const i32 max12X = x1 > x2 ? x1 : x2;
	const i32 min12Y = y1 < y2 ? y1 : y2;
	const i32 max12Y = y1 > y2 ? y1 : y2;
	const i32 sourceLeft = x0 < min12X ? x0 : min12X;
	const i32 sourceRight = x0 > max12X ? x0 : max12X;
	const i32 sourceTop = y0 < min12Y ? y0 : min12Y;
	const i32 sourceBottom = y0 > max12Y ? y0 : max12Y;
	if (sourceRight - sourceLeft + 1 > 1024 || sourceBottom - sourceTop + 1 > 512) return 0;
	const i32 left = static_cast<i32>(gxGpuDrawingAreaLeft(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 top = static_cast<i32>(gxGpuDrawingAreaTop(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 right = static_cast<i32>(gxGpuDrawingAreaRightExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 bottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	if (left >= right || top >= bottom) return 0;
	const i32 rightEdge = right - 1;
	const i32 bottomEdge = bottom - 1;
	x0 = x0 < left ? left : (x0 > rightEdge ? rightEdge : x0);
	y0 = y0 < top ? top : (y0 > bottomEdge ? bottomEdge : y0);
	x1 = x1 < left ? left : (x1 > rightEdge ? rightEdge : x1);
	y1 = y1 < top ? top : (y1 > bottomEdge ? bottomEdge : y1);
	x2 = x2 < left ? left : (x2 > rightEdge ? rightEdge : x2);
	y2 = y2 < top ? top : (y2 > bottomEdge ? bottomEdge : y2);
	i64 doubleArea = static_cast<i64>(x0) * y1 + static_cast<i64>(x1) * y2 + static_cast<i64>(x2) * y0
		- static_cast<i64>(x0) * y2 - static_cast<i64>(x1) * y0 - static_cast<i64>(x2) * y1;
	if (doubleArea < 0) doubleArea = -doubleArea;
	i64 pixels = doubleArea >> 1u;
	if (textured) pixels += pixels;
	if (semiTransparent || (maskBitModeWord & 0x02u) != 0u) pixels += (pixels + 1) >> 1u;
	if ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) != 0u) pixels >>= 1u;
	return pixels;
}

i64 polygonTicks(
	u8 opcode,
	const u32* words,
	size_t wordStart,
	u32 drawModeWord,
	u32 drawingAreaTopLeftWord,
	u32 drawingAreaBottomRightWord,
	u32 drawingOffsetWord,
	u32 maskBitModeWord,
	u8 interlacedRenderWord) {
	const bool packetTextured = (opcode & 0x04u) != 0u;
	const bool textured = packetTextured && (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) == 0u;
	const bool quad = (opcode & 0x08u) != 0u;
	const bool gouraud = (opcode & 0x10u) != 0u;
	i64 ticks = (quad ? 82 : 46) + (gouraud ? 288 : 0) + (textured ? (gouraud ? 162 : 180) : 0);
	const size_t stride = 1u + (packetTextured ? 1u : 0u) + (gouraud ? 1u : 0u);
	const i32 offsetX = gxGpuSigned11(drawingOffsetWord);
	const i32 offsetY = gxGpuSigned11(drawingOffsetWord >> 11u);
	const u32 vertex0 = words[wordStart + 1u];
	const u32 vertex1 = words[wordStart + 1u + stride];
	const u32 vertex2 = words[wordStart + 1u + stride * 2u];
	const i32 x0 = gxGpuSigned11(vertex0) + offsetX;
	const i32 y0 = gxGpuSigned11(vertex0 >> 16u) + offsetY;
	const i32 x1 = gxGpuSigned11(vertex1) + offsetX;
	const i32 y1 = gxGpuSigned11(vertex1 >> 16u) + offsetY;
	const i32 x2 = gxGpuSigned11(vertex2) + offsetX;
	const i32 y2 = gxGpuSigned11(vertex2 >> 16u) + offsetY;
	const bool semiTransparent = (opcode & 0x02u) != 0u;
	ticks += triangleTicks(x0, y0, x1, y1, x2, y2, textured, semiTransparent, drawingAreaTopLeftWord, drawingAreaBottomRightWord, maskBitModeWord, interlacedRenderWord);
	if (quad) {
		const u32 vertex3 = words[wordStart + 1u + stride * 3u];
		const i32 x3 = gxGpuSigned11(vertex3) + offsetX;
		const i32 y3 = gxGpuSigned11(vertex3 >> 16u) + offsetY;
		ticks += triangleTicks(x2, y2, x1, y1, x3, y3, textured, semiTransparent, drawingAreaTopLeftWord, drawingAreaBottomRightWord, maskBitModeWord, interlacedRenderWord);
	}
	return ticks;
}

i64 rectangleTicks(
	u8 opcode,
	const u32* words,
	size_t wordStart,
	u32 wordCount,
	u32 drawModeWord,
	u32 drawingAreaTopLeftWord,
	u32 drawingAreaBottomRightWord,
	u32 drawingOffsetWord,
	u32 maskBitModeWord,
	u8 interlacedRenderWord) {
	u32 width;
	u32 height;
	switch (opcode & 0x18u) {
		case 0x08u: width = 1u; height = 1u; break;
		case 0x10u: width = 8u; height = 8u; break;
		case 0x18u: width = 16u; height = 16u; break;
		default: {
			const u32 sizeWord = words[wordStart + wordCount - 1u];
			width = sizeWord & 0x3ffu;
			height = (sizeWord >> 16u) & 0x1ffu;
			break;
		}
	}
	const u32 positionWord = words[wordStart + 1u];
	const i32 x = gxGpuSigned11(positionWord) + gxGpuSigned11(drawingOffsetWord);
	const i32 y = gxGpuSigned11(positionWord >> 16u) + gxGpuSigned11(drawingOffsetWord >> 11u);
	const i32 areaLeft = static_cast<i32>(gxGpuDrawingAreaLeft(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 areaTop = static_cast<i32>(gxGpuDrawingAreaTop(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 areaRight = static_cast<i32>(gxGpuDrawingAreaRightExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 areaBottom = static_cast<i32>(gxGpuDrawingAreaBottomExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord));
	const i32 left = x > areaLeft ? x : areaLeft;
	const i32 top = y > areaTop ? y : areaTop;
	const i32 right = x + static_cast<i32>(width) < areaRight ? x + static_cast<i32>(width) : areaRight;
	const i32 bottom = y + static_cast<i32>(height) < areaBottom ? y + static_cast<i32>(height) : areaBottom;
	if (left >= right || top >= bottom) return 16;
	const u32 drawnWidth = static_cast<u32>(right - left);
	u32 drawnHeight = static_cast<u32>(bottom - top);
	u32 ticksPerRow = drawnWidth;
	const bool textured = (opcode & 0x04u) != 0u && (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) == 0u;
	if (textured) {
		switch ((drawModeWord >> 7u) & 0x3u) {
			case GX_GPU_TEXTURE_MODE_PALETTE4:
				ticksPerRow += drawnWidth;
				break;
			case GX_GPU_TEXTURE_MODE_PALETTE8:
				if (drawnWidth > 128u) {
					ticksPerRow += (drawnWidth >> 2u) * 8u;
				} else if (drawnWidth * drawnHeight > 2048u) {
					ticksPerRow += (drawnWidth >> 2u) * (4u * (128u / drawnWidth));
				} else {
					ticksPerRow += drawnWidth;
				}
				break;
			case GX_GPU_TEXTURE_MODE_DIRECT16:
			default:
				if (drawnWidth > 128u) {
					ticksPerRow += (drawnWidth >> 1u) * 8u;
				} else if (drawnWidth * drawnHeight > 1024u) {
					ticksPerRow += (drawnWidth >> 2u) * (8u * (128u / drawnWidth));
				} else {
					ticksPerRow += drawnWidth;
				}
				break;
		}
	}
	if ((opcode & 0x02u) != 0u || (maskBitModeWord & 0x02u) != 0u) ticksPerRow += (drawnWidth + 1u) >> 1u;
	if ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) != 0u) {
		drawnHeight >>= 1u;
		if (drawnHeight == 0u) drawnHeight = 1u;
	}
	return 16 + static_cast<i64>(ticksPerRow) * drawnHeight;
}

i64 polylineTicks(
	u8 opcode,
	const u32* words,
	size_t wordStart,
	u32 wordCount,
	u32 drawingAreaTopLeftWord,
	u32 drawingAreaBottomRightWord,
	u32 drawingOffsetWord,
	u8 interlacedRenderWord) {
	const size_t stride = (opcode & 0x10u) != 0u ? 2u : 1u;
	const i32 offsetX = gxGpuSigned11(drawingOffsetWord);
	const i32 offsetY = gxGpuSigned11(drawingOffsetWord >> 11u);
	size_t positionIndex = wordStart + 1u;
	u32 positionWord = words[positionIndex];
	i32 x0 = gxGpuSigned11(positionWord) + offsetX;
	i32 y0 = gxGpuSigned11(positionWord >> 16u) + offsetY;
	i64 ticks = 16;
	positionIndex += stride;
	while (positionIndex < wordStart + wordCount) {
		positionWord = words[positionIndex];
		const i32 x1 = gxGpuSigned11(positionWord) + offsetX;
		const i32 y1 = gxGpuSigned11(positionWord >> 16u) + offsetY;
		ticks += lineTicks(x0, y0, x1, y1, drawingAreaTopLeftWord, drawingAreaBottomRightWord, interlacedRenderWord);
		x0 = x1;
		y0 = y1;
		positionIndex += stride;
	}
	return ticks;
}

} // namespace

i64 gxGpuCommandTicks(
	u8 kind,
	u8 opcode,
	const u32* words,
	size_t wordStart,
	u32 wordCount,
	u32 drawModeWord,
	u32 drawingAreaTopLeftWord,
	u32 drawingAreaBottomRightWord,
	u32 drawingOffsetWord,
	u32 maskBitModeWord,
	u8 interlacedRenderWord) {
	switch (kind) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			return polygonTicks(opcode, words, wordStart, drawModeWord, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, maskBitModeWord, interlacedRenderWord);
		case GX_GPU_COMMAND_DRAW_LINE: {
			const i32 offsetX = gxGpuSigned11(drawingOffsetWord);
			const i32 offsetY = gxGpuSigned11(drawingOffsetWord >> 11u);
			const u32 first = words[wordStart + 1u];
			const u32 second = words[wordStart + ((opcode & 0x10u) != 0u ? 3u : 2u)];
			return lineTicks(gxGpuSigned11(first) + offsetX, gxGpuSigned11(first >> 16u) + offsetY, gxGpuSigned11(second) + offsetX, gxGpuSigned11(second >> 16u) + offsetY, drawingAreaTopLeftWord, drawingAreaBottomRightWord, interlacedRenderWord);
		}
		case GX_GPU_COMMAND_DRAW_POLYLINE:
			return polylineTicks(opcode, words, wordStart, wordCount, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, interlacedRenderWord);
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			return rectangleTicks(opcode, words, wordStart, wordCount, drawModeWord, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, maskBitModeWord, interlacedRenderWord);
		case GX_GPU_COMMAND_FILL_RECTANGLE: {
			const u32 sizeWord = words[wordStart + 2u];
			const u32 width = ((sizeWord & 0x3ffu) + 0x0fu) & ~0x0fu;
			const u32 height = (sizeWord >> 16u) & 0x1ffu;
			return 46 + static_cast<i64>((width >> 3u) + 9u) * height;
		}
		case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM: {
			const u32 sizeWord = words[wordStart + 3u];
			const u32 width = (((sizeWord & 0xffffu) - 1u) & 0x3ffu) + 1u;
			const u32 height = ((((sizeWord >> 16u) & 0xffffu) - 1u) & 0x1ffu) + 1u;
			return static_cast<i64>(width) * height * 2;
		}
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
		case GX_GPU_COMMAND_READ_VRAM_TO_CPU:
		default:
			return 1;
	}
}

} // namespace bmsx
