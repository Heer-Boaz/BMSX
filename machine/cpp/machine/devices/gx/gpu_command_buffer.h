#pragma once

#include "common/primitives.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t GX_GPU_COMMAND_CAPACITY = 4096u;
constexpr size_t GX_GPU_COMMAND_WORD_CAPACITY = 0x80000u;
constexpr u32 GX_GPU_VRAM_WIDTH = 1024u;
constexpr u32 GX_GPU_VRAM_HEIGHT = 512u;
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

constexpr u8 GX_GPU_COMMAND_DRAW_POLYGON = 1u;
constexpr u8 GX_GPU_COMMAND_DRAW_LINE = 2u;
constexpr u8 GX_GPU_COMMAND_DRAW_POLYLINE = 3u;
constexpr u8 GX_GPU_COMMAND_DRAW_RECTANGLE = 4u;
constexpr u8 GX_GPU_COMMAND_FILL_RECTANGLE = 5u;
constexpr u8 GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6u;
constexpr u8 GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7u;
constexpr u8 GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8u;

inline u32 gxGpuDisplayStartY(u32 word) {
	return (word >> 10u) & 0x1ffu;
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

inline u32 gxGpuTransferWidth(u32 sizeWord) {
	return (((sizeWord & 0xffffu) - 1u) & 0x3ffu) + 1u;
}

inline u32 gxGpuTransferHeight(u32 sizeWord) {
	return ((((sizeWord >> 16u) & 0xffffu) - 1u) & 0x1ffu) + 1u;
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

struct GxGpuCommandBuffer {
private:
	inline static u32 nextSerial = 0u;

public:
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
		nextSerial += 1u;
		serial = nextSerial;
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
