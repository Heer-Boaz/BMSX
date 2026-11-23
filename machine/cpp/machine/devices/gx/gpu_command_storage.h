#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_packet.h"
#include "spec/gx/vram.h"
#include "spec/gx/gp0.h"

#include <algorithm>
#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t GX_GPU_COMMAND_CAPACITY = 4096u;
constexpr size_t GX_GPU_COMMAND_WORD_CAPACITY = 0x80000u;
constexpr size_t GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT = 3u + (GX_GPU_TRANSFER_MAX_PIXEL_COUNT >> 1u);
constexpr size_t GX_GPU_COMMAND_WORD_DRAIN_THRESHOLD = GX_GPU_COMMAND_WORD_CAPACITY - GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT;
constexpr u8 GX_GPU_READBACK_IDLE = 0u;
constexpr u8 GX_GPU_READBACK_PENDING = 1u;
constexpr u8 GX_GPU_READBACK_SUBMITTED = 2u;
constexpr u8 GX_GPU_READBACK_READY = 3u;
// Raw, latched backend commands. The device owns writable ingress storage;
// published batches own independent storage until their consumer has finished.
struct GxGpuCommandStorage {
	u32 serial = 0u;
	size_t commandCount = 0u;
	size_t executedCommandCount = 0u;
	size_t presentCommandCount = 0u;
	size_t wordHead = 0u;
	size_t wordCount = 0u;
	size_t drawCount = 0u;
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandKind{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandOpcode{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandWordStart{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandWordCount{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawModeWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandVramYAddressExtensionWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandTextureWindowWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingAreaTopLeftWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingAreaBottomRightWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandDrawingOffsetWord{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> commandMaskBitModeWord{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> commandSkippedLineParity{};
	// Draw records describe the existing raw word span, never a second copy of
	// the packet. commandDrawIndex is the draw prefix count before this command.
	std::array<u16, GX_GPU_COMMAND_CAPACITY> commandDrawIndex{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> drawVertexCount{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> drawPositionStride{};
	std::array<u8, GX_GPU_COMMAND_CAPACITY> drawColorStride{};
	std::array<u32, GX_GPU_COMMAND_CAPACITY> drawSizeOffset{};
	std::array<u32, GX_GPU_COMMAND_WORD_CAPACITY> words{};

	size_t wordEnd() const { return wordHead + wordCount; }

	void appendDrawLayout(size_t index) {
		commandDrawIndex[index] = static_cast<u16>(drawCount);
		const u8 kind = commandKind[index];
		if (kind < GX_GPU_COMMAND_DRAW_POLYGON || kind > GX_GPU_COMMAND_DRAW_RECTANGLE) return;
		const u8 opcode = commandOpcode[index];
		const u8 gouraud = (opcode >> 4u) & 1u;
		u8 stride = 1u;
		u32 vertices = 1u;
		if (kind == GX_GPU_COMMAND_DRAW_POLYGON) {
			stride += ((opcode >> 2u) & 1u) + gouraud;
			vertices = 3u + ((opcode >> 3u) & 1u);
		} else if (kind == GX_GPU_COMMAND_DRAW_LINE || kind == GX_GPU_COMMAND_DRAW_POLYLINE) {
			stride += gouraud;
			vertices = kind == GX_GPU_COMMAND_DRAW_LINE ? 2u : 1u + (commandWordCount[index] - 2u) / stride;
		}
		drawVertexCount[drawCount] = vertices;
		drawPositionStride[drawCount] = stride;
		drawColorStride[drawCount] = kind != GX_GPU_COMMAND_DRAW_RECTANGLE && gouraud != 0u ? stride : 0u;
		drawSizeOffset[drawCount] = kind == GX_GPU_COMMAND_DRAW_RECTANGLE ? commandWordCount[index] - 1u : 0u;
		++drawCount;
	}

	void copyPrefix(const GxGpuCommandStorage& source, size_t count) {
		serial = source.serial;
		commandCount = executedCommandCount = count;
		presentCommandCount = std::min(source.presentCommandCount, count);
		wordHead = 0u;
		wordCount = count == 0u ? 0u
			: source.commandWordStart[count - 1u] + source.commandWordCount[count - 1u] - source.wordHead;
		drawCount = count == source.commandCount ? source.drawCount : source.commandDrawIndex[count];
		std::copy_n(source.commandKind.begin(), count, commandKind.begin());
		std::copy_n(source.commandOpcode.begin(), count, commandOpcode.begin());
		for (size_t i = 0u; i < count; ++i) commandWordStart[i] = source.commandWordStart[i] - static_cast<u32>(source.wordHead);
		std::copy_n(source.commandWordCount.begin(), count, commandWordCount.begin());
		std::copy_n(source.commandDrawModeWord.begin(), count, commandDrawModeWord.begin());
		std::copy_n(source.commandVramYAddressExtensionWord.begin(), count, commandVramYAddressExtensionWord.begin());
		std::copy_n(source.commandTextureWindowWord.begin(), count, commandTextureWindowWord.begin());
		std::copy_n(source.commandDrawingAreaTopLeftWord.begin(), count, commandDrawingAreaTopLeftWord.begin());
		std::copy_n(source.commandDrawingAreaBottomRightWord.begin(), count, commandDrawingAreaBottomRightWord.begin());
		std::copy_n(source.commandDrawingOffsetWord.begin(), count, commandDrawingOffsetWord.begin());
		std::copy_n(source.commandMaskBitModeWord.begin(), count, commandMaskBitModeWord.begin());
		std::copy_n(source.commandSkippedLineParity.begin(), count, commandSkippedLineParity.begin());
		std::copy_n(source.commandDrawIndex.begin(), count, commandDrawIndex.begin());
		std::copy_n(source.drawVertexCount.begin(), drawCount, drawVertexCount.begin());
		std::copy_n(source.drawPositionStride.begin(), drawCount, drawPositionStride.begin());
		std::copy_n(source.drawColorStride.begin(), drawCount, drawColorStride.begin());
		std::copy_n(source.drawSizeOffset.begin(), drawCount, drawSizeOffset.begin());
		std::copy_n(source.words.begin() + static_cast<std::ptrdiff_t>(source.wordHead), wordCount, words.begin());
	}
};

// The renderer produces bytes; only the device owner publishes their readiness.
struct GxGpuReadbackRequest {
	u32 x;
	u32 y;
	u32 width;
	u32 height;
	u32 vramYAddressExtensionWord;
};

} // namespace bmsx
