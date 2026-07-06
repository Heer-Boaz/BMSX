#pragma once

#include "common/primitives.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t GX_GPU_COMMAND_CAPACITY = 4096u;
constexpr size_t GX_GPU_COMMAND_WORD_CAPACITY = 0x80000u;

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

inline i32 gxGpuDrawingOffsetX(u32 word) {
	return gxGpuSigned11(word);
}

inline i32 gxGpuDrawingOffsetY(u32 word) {
	return gxGpuSigned11(word >> 11u);
}

inline bool gxGpuCommandTextureEnabled(u32 opcode) {
	return (opcode & 0x04u) != 0u;
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
		u32 maskBitModeWord) {
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
		commandCount = commandIndex + 1u;
	}
};

} // namespace bmsx
