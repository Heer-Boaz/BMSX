#pragma once

#include "common/primitives.h"

#include <array>
#include <cstddef>
#include <vector>

namespace bmsx {

constexpr size_t GX_GPU_COMMAND_CAPACITY = 4096u;
constexpr size_t GX_GPU_COMMAND_WORD_CAPACITY = 0x80000u;
constexpr u32 GX_GPU_VRAM_WIDTH = 1024u;
constexpr u32 GX_GPU_VRAM_HEIGHT = 512u;
constexpr size_t GX_GPU_VRAM_WORD_COUNT = static_cast<size_t>(GX_GPU_VRAM_WIDTH) * static_cast<size_t>(GX_GPU_VRAM_HEIGHT);
constexpr size_t GX_GPU_VRAM_BYTE_COUNT = GX_GPU_VRAM_WORD_COUNT * 2u;
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

struct GxGpuCommandBufferState {
	size_t commandCount = 0u;
	size_t presentCommandCount = 0u;
	size_t wordCount = 0u;
	std::vector<u8> commandKind;
	std::vector<u8> commandOpcode;
	std::vector<u32> commandWordStart;
	std::vector<u32> commandWordCount;
	std::vector<u32> commandDrawModeWord;
	std::vector<u32> commandTextureWindowWord;
	std::vector<u32> commandDrawingAreaTopLeftWord;
	std::vector<u32> commandDrawingAreaBottomRightWord;
	std::vector<u32> commandDrawingOffsetWord;
	std::vector<u32> commandMaskBitModeWord;
	std::vector<u8> commandInterlacedRenderWord;
	std::vector<u32> words;
};

struct GxGpuCommandBuffer {
private:
	inline static u32 nextSerial = 0u;
	inline static u32 nextVramClearSerial = 0u;

	void publishRevision(bool vramCleared) {
		nextSerial += 1u;
		serial = nextSerial;
		if (vramCleared) {
			nextVramClearSerial += 1u;
			vramClearSerial = nextVramClearSerial;
		}
	}

public:
	u32 serial = 0u;
	u32 vramClearSerial = 0u;
	size_t commandCount = 0u;
	size_t presentCommandCount = 0u;
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
		publishRevision(true);
		commandCount = 0u;
		presentCommandCount = 0u;
		wordCount = 0u;
	}

	GxGpuCommandBufferState captureState() const {
		GxGpuCommandBufferState state;
		state.commandCount = commandCount;
		state.presentCommandCount = presentCommandCount;
		state.wordCount = wordCount;
		state.commandKind.assign(commandKind.begin(), commandKind.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandOpcode.assign(commandOpcode.begin(), commandOpcode.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandWordStart.assign(commandWordStart.begin(), commandWordStart.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandWordCount.assign(commandWordCount.begin(), commandWordCount.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawModeWord.assign(commandDrawModeWord.begin(), commandDrawModeWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandTextureWindowWord.assign(commandTextureWindowWord.begin(), commandTextureWindowWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawingAreaTopLeftWord.assign(commandDrawingAreaTopLeftWord.begin(), commandDrawingAreaTopLeftWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawingAreaBottomRightWord.assign(commandDrawingAreaBottomRightWord.begin(), commandDrawingAreaBottomRightWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawingOffsetWord.assign(commandDrawingOffsetWord.begin(), commandDrawingOffsetWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandMaskBitModeWord.assign(commandMaskBitModeWord.begin(), commandMaskBitModeWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandInterlacedRenderWord.assign(commandInterlacedRenderWord.begin(), commandInterlacedRenderWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.words.assign(words.begin(), words.begin() + static_cast<std::ptrdiff_t>(wordCount));
		return state;
	}

	void restoreState(const GxGpuCommandBufferState& state) {
		publishRevision(false);
		commandCount = state.commandCount;
		presentCommandCount = state.presentCommandCount;
		wordCount = state.wordCount;
		for (size_t index = 0u; index < commandCount; index += 1u) {
			commandKind[index] = state.commandKind[index];
			commandOpcode[index] = state.commandOpcode[index];
			commandWordStart[index] = state.commandWordStart[index];
			commandWordCount[index] = state.commandWordCount[index];
			commandDrawModeWord[index] = state.commandDrawModeWord[index];
			commandTextureWindowWord[index] = state.commandTextureWindowWord[index];
			commandDrawingAreaTopLeftWord[index] = state.commandDrawingAreaTopLeftWord[index];
			commandDrawingAreaBottomRightWord[index] = state.commandDrawingAreaBottomRightWord[index];
			commandDrawingOffsetWord[index] = state.commandDrawingOffsetWord[index];
			commandMaskBitModeWord[index] = state.commandMaskBitModeWord[index];
			commandInterlacedRenderWord[index] = state.commandInterlacedRenderWord[index];
		}
		for (size_t index = 0u; index < wordCount; index += 1u) {
			words[index] = state.words[index];
		}
	}

	size_t retireCommandsPreservingVram() {
		const size_t retiredCommands = presentCommandCount;
		if (retiredCommands == 0u) {
			return 0u;
		}
		const size_t oldCommandCount = commandCount;
		const size_t retiredWords = retiredCommands == oldCommandCount
			? commandWordStart[retiredCommands - 1u] + commandWordCount[retiredCommands - 1u]
			: commandWordStart[retiredCommands];
		const size_t remainingCommands = oldCommandCount - retiredCommands;
		const size_t remainingWords = wordCount - retiredWords;
		for (size_t commandIndex = 0u; commandIndex < remainingCommands; commandIndex += 1u) {
			const size_t sourceIndex = retiredCommands + commandIndex;
			commandKind[commandIndex] = commandKind[sourceIndex];
			commandOpcode[commandIndex] = commandOpcode[sourceIndex];
			commandWordStart[commandIndex] = commandWordStart[sourceIndex] - static_cast<u32>(retiredWords);
			commandWordCount[commandIndex] = commandWordCount[sourceIndex];
			commandDrawModeWord[commandIndex] = commandDrawModeWord[sourceIndex];
			commandTextureWindowWord[commandIndex] = commandTextureWindowWord[sourceIndex];
			commandDrawingAreaTopLeftWord[commandIndex] = commandDrawingAreaTopLeftWord[sourceIndex];
			commandDrawingAreaBottomRightWord[commandIndex] = commandDrawingAreaBottomRightWord[sourceIndex];
			commandDrawingOffsetWord[commandIndex] = commandDrawingOffsetWord[sourceIndex];
			commandMaskBitModeWord[commandIndex] = commandMaskBitModeWord[sourceIndex];
			commandInterlacedRenderWord[commandIndex] = commandInterlacedRenderWord[sourceIndex];
		}
		for (size_t wordIndex = 0u; wordIndex < remainingWords; wordIndex += 1u) {
			words[wordIndex] = words[retiredWords + wordIndex];
		}
		commandCount = remainingCommands;
		presentCommandCount = 0u;
		wordCount = remainingWords;
		publishRevision(false);
		return retiredWords;
	}

	void sealCommandsForPresentation() {
		presentCommandCount = commandCount;
	}

	bool hasUnretiredPresentCommands() const {
		return presentCommandCount != 0u;
	}

	void appendWord(u32 word) {
		words[wordCount] = word;
		wordCount += 1u;
	}

	size_t appendWords(const u32* sourceWords, size_t sourceWordCount) {
		for (size_t index = 0u; index < sourceWordCount; index += 1u) {
			words[wordCount] = sourceWords[index];
			wordCount += 1u;
		}
		return wordCount - sourceWordCount;
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
