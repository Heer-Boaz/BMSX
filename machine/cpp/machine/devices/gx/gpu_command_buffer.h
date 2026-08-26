#pragma once

#include "common/primitives.h"
#include "spec/bmsx/io.h"
#include "machine/devices/dma/controller.h"
#include "spec/gx/gp0.h"
#include "spec/gx/vram.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <memory>
#include <vector>

namespace bmsx {

class GxGpu;

constexpr size_t GX_GPU_COMMAND_CAPACITY = 4096u;
constexpr size_t GX_GPU_COMMAND_WORD_CAPACITY = 0x80000u;
constexpr size_t GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT = 3u + (GX_GPU_TRANSFER_MAX_PIXEL_COUNT >> 1u);
constexpr size_t GX_GPU_COMMAND_WORD_DRAIN_THRESHOLD = GX_GPU_COMMAND_WORD_CAPACITY - GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT;
constexpr u8 GX_GPU_SKIPPED_LINE_NONE = 2u;

constexpr u8 GX_GPU_COMMAND_DRAW_POLYGON = 1u;
constexpr u8 GX_GPU_COMMAND_DRAW_LINE = 2u;
constexpr u8 GX_GPU_COMMAND_DRAW_POLYLINE = 3u;
constexpr u8 GX_GPU_COMMAND_DRAW_RECTANGLE = 4u;
constexpr u8 GX_GPU_COMMAND_FILL_RECTANGLE = 5u;
constexpr u8 GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6u;
constexpr u8 GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7u;
constexpr u8 GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8u;
constexpr u8 GX_GPU_READBACK_IDLE = 0u;
constexpr u8 GX_GPU_READBACK_PENDING = 1u;
constexpr u8 GX_GPU_READBACK_SUBMITTED = 2u;
constexpr u8 GX_GPU_READBACK_READY = 3u;
struct GxGpuCommandBufferState {
	size_t commandCount = 0u;
	size_t executedCommandCount = 0u;
	size_t presentCommandCount = 0u;
	size_t wordCount = 0u;
	std::vector<u8> commandKind;
	std::vector<u8> commandOpcode;
	std::vector<u32> commandWordStart;
	std::vector<u32> commandWordCount;
	std::vector<u32> commandDrawModeWord;
	std::vector<u8> commandVramYAddressExtensionWord;
	std::vector<u32> commandTextureWindowWord;
	std::vector<u32> commandDrawingAreaTopLeftWord;
	std::vector<u32> commandDrawingAreaBottomRightWord;
	std::vector<u32> commandDrawingOffsetWord;
	std::vector<u32> commandMaskBitModeWord;
	std::vector<u8> commandSkippedLineParity;
	std::vector<u32> words;
	u8 readbackPhase = GX_GPU_READBACK_IDLE;
	size_t readbackFenceCommandCount = 0u;
	u32 readbackX = 0u;
	u32 readbackY = 0u;
	u8 readbackVramYAddressExtensionWord = 0u;
	u32 readbackWidth = 0u;
	u32 readbackHeight = 0u;
	u32 readbackPixelCursor = 0u;
	std::vector<u8> readbackPixelBytes;
};

class GxGpuReadbackPort {
public:
	explicit GxGpuReadbackPort(DmaController& dmaController)
		: m_dmaController(dmaController) {
	}

	u8 phase() const { return m_phase; }
	size_t fenceCommandCount() const { return m_fenceCommandCount; }
	u32 x() const { return m_x; }
	u32 y() const { return m_y; }
	u8 vramYAddressExtensionWord() const { return m_vramYAddressExtensionWord; }
	u32 width() const { return m_width; }
	u32 height() const { return m_height; }
	u32 pixelCursor() const { return m_pixelCursor; }
	u32 token() const { return m_token; }
	u8* pixelBytes() { return m_pixelBytes.get(); }
	const u8* pixelBytes() const { return m_pixelBytes.get(); }
	void setDmaReadEnabled(bool enabled) {
		m_dmaReadEnabled = enabled;
		updateDmaRequest();
	}

	bool claimReadback(size_t executedCommandCount) {
		if (m_phase != GX_GPU_READBACK_PENDING || executedCommandCount != m_fenceCommandCount) {
			return false;
		}
		m_phase = GX_GPU_READBACK_SUBMITTED;
		return true;
	}

	void completeReadback(u32 token) {
		if (m_phase == GX_GPU_READBACK_SUBMITTED && m_token == token) {
			m_phase = GX_GPU_READBACK_READY;
			updateDmaRequest();
		}
	}

private:
	friend class GxGpu;
	friend struct GxGpuCommandBuffer;

	u32 readWord() {
		size_t byteIndex = static_cast<size_t>(m_pixelCursor) * 2u;
		u32 word = static_cast<u32>(m_pixelBytes[byteIndex]) | (static_cast<u32>(m_pixelBytes[byteIndex + 1u]) << 8u);
		m_pixelCursor += 1u;
		const u32 pixelCount = m_width * m_height;
		if (m_pixelCursor < pixelCount) {
			byteIndex = static_cast<size_t>(m_pixelCursor) * 2u;
			word |= (static_cast<u32>(m_pixelBytes[byteIndex]) | (static_cast<u32>(m_pixelBytes[byteIndex + 1u]) << 8u)) << 16u;
			m_pixelCursor += 1u;
		}
		if (m_pixelCursor == pixelCount) {
			m_phase = GX_GPU_READBACK_IDLE;
			m_fenceCommandCount = 0u;
			m_x = 0u;
			m_y = 0u;
			m_vramYAddressExtensionWord = 0u;
			m_width = 0u;
			m_height = 0u;
			m_pixelCursor = 0u;
			updateDmaRequest();
		}
		return word;
	}

	void activate(u32 positionWord, u32 sizeWord, size_t fenceCommandCount, u8 vramYAddressExtensionWord) {
		m_x = positionWord & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
		m_vramYAddressExtensionWord = vramYAddressExtensionWord;
		m_y = gxGpuVramYAddress(positionWord >> 16u, vramYAddressExtensionWord);
		m_width = gxGpuTransferWidth(sizeWord);
		m_height = gxGpuTransferHeight(sizeWord);
		m_pixelCursor = 0u;
		m_fenceCommandCount = fenceCommandCount;
		m_token += 1u;
		m_phase = GX_GPU_READBACK_PENDING;
		updateDmaRequest();
	}

	void reset() {
		m_phase = GX_GPU_READBACK_IDLE;
		m_fenceCommandCount = 0u;
		m_x = 0u;
		m_y = 0u;
		m_vramYAddressExtensionWord = 0u;
		m_width = 0u;
		m_height = 0u;
		m_pixelCursor = 0u;
		m_token += 1u;
		updateDmaRequest();
	}

	void updateDmaRequest() {
		const u32 requestBit = 1u << DMA_REQUEST_GX_READ;
		m_dmaController.setRequestLines(requestBit, m_dmaReadEnabled && m_phase == GX_GPU_READBACK_READY ? requestBit : 0u);
	}

	u8 m_phase = GX_GPU_READBACK_IDLE;
	size_t m_fenceCommandCount = 0u;
	u32 m_x = 0u;
	u32 m_y = 0u;
	u8 m_vramYAddressExtensionWord = 0u;
	u32 m_width = 0u;
	u32 m_height = 0u;
	u32 m_pixelCursor = 0u;
	std::unique_ptr<u8[]> m_pixelBytes = std::make_unique<u8[]>(GX_GPU_TRANSFER_MAX_BYTE_COUNT);
	u32 m_token = 0u;
	bool m_dmaReadEnabled = false;
	DmaController& m_dmaController;
};

struct GxGpuCommandBuffer {
private:
	inline static u32 nextSerial = 0u;

	void publishRevision() {
		nextSerial += 1u;
		serial = nextSerial;
	}

	void activateReadback(size_t commandIndex) {
		const size_t wordStart = commandWordStart[commandIndex];
		readback.activate(words[wordStart + 1u], words[wordStart + 2u], commandIndex + 1u, commandVramYAddressExtensionWord[commandIndex]);
	}

	void clearCommandState() {
		commandCount = 0u;
		executedCommandCount = 0u;
		presentCommandCount = 0u;
		wordCount = 0u;
		readback.reset();
	}

public:
	explicit GxGpuCommandBuffer(DmaController& dmaController)
		: readback(dmaController) {
	}

	u32 serial = 0u;
	size_t commandCount = 0u;
	size_t executedCommandCount = 0u;
	size_t presentCommandCount = 0u;
	size_t wordCount = 0u;
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandKind{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandOpcode{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandWordStart{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandWordCount{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawModeWord{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandVramYAddressExtensionWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandTextureWindowWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingAreaTopLeftWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingAreaBottomRightWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingOffsetWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandMaskBitModeWord{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandSkippedLineParity{};
	std::array<u32, GX_GPU_COMMAND_WORD_CAPACITY> words{};
	GxGpuReadbackPort readback;

	void reset() {
		publishRevision();
		clearCommandState();
	}

	void abortReadbackAndQueuedCommands() {
		if (readback.m_phase == GX_GPU_READBACK_IDLE) {
			// C0 is retained before its execution deadline activates the readback port.
			const size_t commandIndex = executedCommandCount;
			if (commandIndex == commandCount || commandKind[commandIndex] != GX_GPU_COMMAND_READ_VRAM_TO_CPU) {
				return;
			}
			commandCount = commandIndex;
			wordCount = commandWordStart[commandIndex];
			if (presentCommandCount > commandIndex) {
				presentCommandCount = commandIndex;
			}
			return;
		}
		if (readback.m_phase == GX_GPU_READBACK_PENDING && readback.m_fenceCommandCount != 0u) {
			commandCount = readback.m_fenceCommandCount - 1u;
			wordCount = commandWordStart[commandCount];
			if (executedCommandCount > commandCount) {
				executedCommandCount = commandCount;
			}
			if (presentCommandCount > commandCount) {
				presentCommandCount = commandCount;
			}
			readback.reset();
			return;
		}
		publishRevision();
		clearCommandState();
	}

	GxGpuCommandBufferState captureState() const {
		GxGpuCommandBufferState state;
		state.commandCount = commandCount;
		state.executedCommandCount = executedCommandCount;
		state.presentCommandCount = presentCommandCount;
		state.wordCount = wordCount;
		state.commandKind.assign(commandKind.begin(), commandKind.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandOpcode.assign(commandOpcode.begin(), commandOpcode.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandWordStart.assign(commandWordStart.begin(), commandWordStart.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandWordCount.assign(commandWordCount.begin(), commandWordCount.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawModeWord.assign(commandDrawModeWord.begin(), commandDrawModeWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandVramYAddressExtensionWord.assign(commandVramYAddressExtensionWord.begin(), commandVramYAddressExtensionWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandTextureWindowWord.assign(commandTextureWindowWord.begin(), commandTextureWindowWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawingAreaTopLeftWord.assign(commandDrawingAreaTopLeftWord.begin(), commandDrawingAreaTopLeftWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawingAreaBottomRightWord.assign(commandDrawingAreaBottomRightWord.begin(), commandDrawingAreaBottomRightWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandDrawingOffsetWord.assign(commandDrawingOffsetWord.begin(), commandDrawingOffsetWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandMaskBitModeWord.assign(commandMaskBitModeWord.begin(), commandMaskBitModeWord.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.commandSkippedLineParity.assign(commandSkippedLineParity.begin(), commandSkippedLineParity.begin() + static_cast<std::ptrdiff_t>(commandCount));
		state.words.assign(words.begin(), words.begin() + static_cast<std::ptrdiff_t>(wordCount));
		state.readbackPhase = readback.m_phase == GX_GPU_READBACK_SUBMITTED ? GX_GPU_READBACK_PENDING : readback.m_phase;
		state.readbackFenceCommandCount = readback.m_fenceCommandCount;
		state.readbackX = readback.m_x;
		state.readbackY = readback.m_y;
		state.readbackVramYAddressExtensionWord = readback.m_vramYAddressExtensionWord;
		state.readbackWidth = readback.m_width;
		state.readbackHeight = readback.m_height;
		state.readbackPixelCursor = readback.m_pixelCursor;
		if (readback.m_phase == GX_GPU_READBACK_READY) {
			const size_t readbackPixelCount = static_cast<size_t>(readback.m_width) * static_cast<size_t>(readback.m_height);
			state.readbackPixelBytes.assign(readback.m_pixelBytes.get(), readback.m_pixelBytes.get() + static_cast<std::ptrdiff_t>(readbackPixelCount * 2u));
		}
		return state;
	}

	void restoreState(const GxGpuCommandBufferState& state) {
		publishRevision();
		commandCount = state.commandCount;
		executedCommandCount = state.executedCommandCount;
		presentCommandCount = state.presentCommandCount;
		wordCount = state.wordCount;
		for (size_t index = 0u; index < commandCount; index += 1u) {
			commandKind[index] = state.commandKind[index];
			commandOpcode[index] = state.commandOpcode[index];
			commandWordStart[index] = state.commandWordStart[index];
			commandWordCount[index] = state.commandWordCount[index];
			commandDrawModeWord[index] = state.commandDrawModeWord[index];
			commandVramYAddressExtensionWord[index] = state.commandVramYAddressExtensionWord[index];
			commandTextureWindowWord[index] = state.commandTextureWindowWord[index];
			commandDrawingAreaTopLeftWord[index] = state.commandDrawingAreaTopLeftWord[index];
			commandDrawingAreaBottomRightWord[index] = state.commandDrawingAreaBottomRightWord[index];
			commandDrawingOffsetWord[index] = state.commandDrawingOffsetWord[index];
			commandMaskBitModeWord[index] = state.commandMaskBitModeWord[index];
			commandSkippedLineParity[index] = state.commandSkippedLineParity[index];
		}
		for (size_t index = 0u; index < wordCount; index += 1u) {
			words[index] = state.words[index];
		}
		readback.m_phase = state.readbackPhase;
		readback.m_fenceCommandCount = state.readbackFenceCommandCount;
		readback.m_x = state.readbackX;
		readback.m_y = state.readbackY;
		readback.m_vramYAddressExtensionWord = state.readbackVramYAddressExtensionWord;
		readback.m_width = state.readbackWidth;
		readback.m_height = state.readbackHeight;
		readback.m_pixelCursor = state.readbackPixelCursor;
		std::copy(state.readbackPixelBytes.begin(), state.readbackPixelBytes.end(), readback.m_pixelBytes.get());
		readback.m_token += 1u;
	}

	size_t retireCommandsPreservingVram(size_t retiredCommands) {
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
			commandVramYAddressExtensionWord[commandIndex] = commandVramYAddressExtensionWord[sourceIndex];
			commandTextureWindowWord[commandIndex] = commandTextureWindowWord[sourceIndex];
			commandDrawingAreaTopLeftWord[commandIndex] = commandDrawingAreaTopLeftWord[sourceIndex];
			commandDrawingAreaBottomRightWord[commandIndex] = commandDrawingAreaBottomRightWord[sourceIndex];
			commandDrawingOffsetWord[commandIndex] = commandDrawingOffsetWord[sourceIndex];
			commandMaskBitModeWord[commandIndex] = commandMaskBitModeWord[sourceIndex];
			commandSkippedLineParity[commandIndex] = commandSkippedLineParity[sourceIndex];
		}
		for (size_t wordIndex = 0u; wordIndex < remainingWords; wordIndex += 1u) {
			words[wordIndex] = words[retiredWords + wordIndex];
		}
		commandCount = remainingCommands;
		executedCommandCount -= retiredCommands;
		presentCommandCount = retiredCommands < presentCommandCount
			? presentCommandCount - retiredCommands
			: 0u;
		wordCount = remainingWords;
		readback.m_fenceCommandCount = retiredCommands < readback.m_fenceCommandCount
			? readback.m_fenceCommandCount - retiredCommands
			: 0u;
		publishRevision();
		return retiredWords;
	}

	void sealCommandsForPresentation() {
		if (readback.m_phase != GX_GPU_READBACK_IDLE) {
			presentCommandCount = readback.m_fenceCommandCount;
		} else {
			presentCommandCount = executedCommandCount;
		}
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

	void completeCommandExecution(size_t completedCommandCount) {
		executedCommandCount = completedCommandCount;
		const size_t commandIndex = completedCommandCount - 1u;
		if (commandKind[commandIndex] == GX_GPU_COMMAND_READ_VRAM_TO_CPU) {
			activateReadback(commandIndex);
		}
	}

	void pushCommand(
		u8 kind,
		u8 opcode,
		size_t wordStart,
		u32 commandWords,
		u32 drawModeWord,
		u8 vramYAddressExtensionWord,
		u32 textureWindowWord,
		u32 drawingAreaTopLeftWord,
		u32 drawingAreaBottomRightWord,
		u32 drawingOffsetWord,
		u32 maskBitModeWord,
		u8 skippedLineParity) {
		const size_t commandIndex = commandCount;
		commandKind[commandIndex] = kind;
		commandOpcode[commandIndex] = opcode;
		commandWordStart[commandIndex] = static_cast<u32>(wordStart);
		commandWordCount[commandIndex] = commandWords;
		commandDrawModeWord[commandIndex] = drawModeWord;
		commandVramYAddressExtensionWord[commandIndex] = vramYAddressExtensionWord;
		commandTextureWindowWord[commandIndex] = textureWindowWord;
		commandDrawingAreaTopLeftWord[commandIndex] = drawingAreaTopLeftWord;
		commandDrawingAreaBottomRightWord[commandIndex] = drawingAreaBottomRightWord;
		commandDrawingOffsetWord[commandIndex] = drawingOffsetWord;
		commandMaskBitModeWord[commandIndex] = maskBitModeWord;
		commandSkippedLineParity[commandIndex] = skippedLineParity;
		commandCount = commandIndex + 1u;
	}
};

} // namespace bmsx
