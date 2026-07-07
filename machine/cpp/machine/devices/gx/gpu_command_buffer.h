#pragma once

#include "common/primitives.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t GX_GPU_COMMAND_CAPACITY = 4096u;
constexpr size_t GX_GPU_COMMAND_WORD_CAPACITY = 0x80000u;
constexpr u32 GX_GPU_VRAM_WIDTH = 1024u;
constexpr u32 GX_GPU_VRAM_HEIGHT = 512u;
constexpr i32 GX_GPU_MAX_PRIMITIVE_WIDTH = 1024;
constexpr i32 GX_GPU_MAX_PRIMITIVE_HEIGHT = 512;
constexpr u32 GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK = 0x09ffu;
constexpr u32 GX_GPU_DRAW_MODE_DITHER_ENABLED = 1u << 9u;
constexpr u32 GX_GPU_DRAW_MODE_TEXTURE_DISABLE = 1u << 11u;
constexpr u32 GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP = 1u << 12u;
constexpr u32 GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP = 1u << 13u;
constexpr u8 GX_GPU_INTERLACED_RENDER_ENABLE = 0x01u;
constexpr u8 GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB = 0x02u;
constexpr u32 GX_GPU_TEXTURE_MODE_PALETTE4 = 0u;
constexpr u32 GX_GPU_TEXTURE_MODE_PALETTE8 = 1u;
constexpr u32 GX_GPU_TEXTURE_MODE_DIRECT16 = 2u;
constexpr u32 GX_GPU_BLEND_MODE_HALF_BACKGROUND_HALF_FOREGROUND = 0u;
constexpr u32 GX_GPU_BLEND_MODE_BACKGROUND_PLUS_FOREGROUND = 1u;
constexpr u32 GX_GPU_BLEND_MODE_BACKGROUND_MINUS_FOREGROUND = 2u;
constexpr u32 GX_GPU_BLEND_MODE_BACKGROUND_PLUS_QUARTER_FOREGROUND = 3u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_256 = 10u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_320 = 8u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_512 = 5u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_640 = 4u;
constexpr u32 GX_GPU_DOT_CLOCK_DIVIDER_368 = 7u;

constexpr u8 GX_GPU_COMMAND_DRAW_POLYGON = 1u;
constexpr u8 GX_GPU_COMMAND_DRAW_LINE = 2u;
constexpr u8 GX_GPU_COMMAND_DRAW_POLYLINE = 3u;
constexpr u8 GX_GPU_COMMAND_DRAW_RECTANGLE = 4u;
constexpr u8 GX_GPU_COMMAND_FILL_RECTANGLE = 5u;
constexpr u8 GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6u;
constexpr u8 GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7u;
constexpr u8 GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8u;

inline i32 gxGpuSigned11(u32 value) {
	const i32 raw = static_cast<i32>(value & 0x7ffu);
	return (raw & 0x400) != 0 ? raw - 0x800 : raw;
}

inline i32 gxGpuVertexX(u32 word) {
	return gxGpuSigned11(word);
}

inline i32 gxGpuVertexY(u32 word) {
	return gxGpuSigned11(word >> 16u);
}

inline u32 gxGpuDisplayStartX(u32 word) {
	return word & 0x3ffu;
}

inline u32 gxGpuDisplayStartY(u32 word) {
	return (word >> 10u) & 0x1ffu;
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

inline i32 gxGpuDrawingOffsetX(u32 word) {
	return gxGpuSigned11(word);
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

inline bool gxGpuDrawModeDitherEnabled(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_DITHER_ENABLED) != 0u;
}

inline bool gxGpuDrawModeTextureRectangleXFlip(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) != 0u;
}

inline bool gxGpuDrawModeTextureRectangleYFlip(u32 drawModeWord) {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) != 0u;
}

inline bool gxGpuSkipDrawingToActiveField(u32 statusWord) {
	constexpr u32 mask = (1u << 19u) | (1u << 22u) | (1u << 10u);
	constexpr u32 active = (1u << 19u) | (1u << 22u);
	return (statusWord & mask) == active;
}

inline u8 gxGpuInterlacedRenderWord(u32 statusWord, u32 activeLineLsb) {
	return gxGpuSkipDrawingToActiveField(statusWord)
		? static_cast<u8>(GX_GPU_INTERLACED_RENDER_ENABLE | ((activeLineLsb & 1u) << 1u))
		: 0u;
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

inline bool gxGpuCommandQuadPolygon(u32 opcode) {
	return (opcode & 0x08u) != 0u;
}

inline bool gxGpuCommandGouraud(u32 opcode) {
	return (opcode & 0x10u) != 0u;
}

inline bool gxGpuDitheredPolygon(u32 drawModeWord, u32 opcode) {
	return gxGpuDrawModeDitherEnabled(drawModeWord)
		&& (gxGpuCommandDrawsTexture(opcode, drawModeWord)
			? !gxGpuCommandRawTextureEnabled(opcode)
			: gxGpuCommandGouraud(opcode));
}

inline u32 gxGpuTextureModulationPreDither(u32 texture5, u32 vertex8) {
	return (texture5 * vertex8) >> 4u;
}

inline u32 gxGpuTextureModulationChannel5(u32 texture5, u32 vertex8, i32 ditherOffset) {
	const i32 dithered = static_cast<i32>(gxGpuTextureModulationPreDither(texture5, vertex8)) + ditherOffset;
	if (dithered < 0) {
		return 0u;
	}
	const u32 channel5 = static_cast<u32>(dithered) >> 3u;
	return channel5 < 31u ? channel5 : 31u;
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

inline u32 gxGpuTransferWidth(u32 sizeWord) {
	return (((sizeWord & 0xffffu) - 1u) & 0x3ffu) + 1u;
}

inline u32 gxGpuTransferHeight(u32 sizeWord) {
	return ((((sizeWord >> 16u) & 0xffffu) - 1u) & 0x1ffu) + 1u;
}

inline u32 gxGpuTransferPixelWord(u32 payloadWord, u32 pixelIndex) {
	return (pixelIndex & 1u) == 0u ? payloadWord & 0xffffu : payloadWord >> 16u;
}

inline u32 gxGpuTextureU(u32 textureWord) {
	return textureWord & 0xffu;
}

inline u32 gxGpuTextureV(u32 textureWord) {
	return (textureWord >> 8u) & 0xffu;
}

inline u32 gxGpuTextureAttribute(u32 textureWord) {
	return (textureWord >> 16u) & 0xffffu;
}

inline u32 gxGpuTextureClutBaseX(u32 textureWord) {
	return (gxGpuTextureAttribute(textureWord) & 0x3fu) << 4u;
}

inline u32 gxGpuTextureClutBaseY(u32 textureWord) {
	return (gxGpuTextureAttribute(textureWord) >> 6u) & 0x1ffu;
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

inline u32 gxGpuPolygonTexturePageWordIndex(u32 opcode) {
	return gxGpuCommandGouraud(opcode) ? 5u : 4u;
}

inline u32 gxGpuPolygonDrawModeWord(u32 drawModeWord, u32 textureAttribute) {
	return (textureAttribute & GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK) | (drawModeWord & ~GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK);
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

struct GxGpuCommandBuffer {
	u32 serial = 0u;
	size_t commandCount = 0u;
	size_t wordCount = 0u;
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandKind{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandOpcode{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandWordStart{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandWordCount{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawModeWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandTextureWindowWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingAreaTopLeftWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingAreaBottomRightWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingOffsetWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandMaskBitModeWord{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandInterlacedRenderWord{};
	std::array<u32, GX_GPU_COMMAND_WORD_CAPACITY> words{};

	void reset() {
		serial += 1u;
		commandCount = 0u;
		wordCount = 0u;
	}

	void appendWord(u32 word) {
		words[wordCount] = word;
		wordCount += 1u;
	}

	size_t appendWords(const u32* sourceWords, size_t sourceWordCount) {
		const size_t wordStart = wordCount;
		for (size_t index = 0u; index < sourceWordCount; index += 1u) {
			words[wordCount] = sourceWords[index];
			wordCount += 1u;
		}
		return wordStart;
	}

	void pushCommand(
		u8 kind,
		u8 opcode,
		size_t wordStart,
		u32 commandWords,
		u32 drawModeWord,
		u32 textureWindowWord,
		u32 drawingAreaTopLeftWord,
		u32 drawingAreaBottomRightWord,
		u32 drawingOffsetWord,
		u32 maskBitModeWord,
		u8 interlacedRenderWord) {
		const size_t commandIndex = commandCount;
		commandKind[commandIndex] = kind;
		commandOpcode[commandIndex] = opcode;
		commandWordStart[commandIndex] = static_cast<u32>(wordStart);
		commandWordCount[commandIndex] = commandWords;
		commandDrawModeWord[commandIndex] = drawModeWord;
		commandTextureWindowWord[commandIndex] = textureWindowWord;
		commandDrawingAreaTopLeftWord[commandIndex] = drawingAreaTopLeftWord;
		commandDrawingAreaBottomRightWord[commandIndex] = drawingAreaBottomRightWord;
		commandDrawingOffsetWord[commandIndex] = drawingOffsetWord;
		commandMaskBitModeWord[commandIndex] = maskBitModeWord;
		commandInterlacedRenderWord[commandIndex] = interlacedRenderWord;
		commandCount = commandIndex + 1u;
	}
};

} // namespace bmsx
