#pragma once

#include "common/primitives.h"
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
// Raw, latched backend commands. The device owns writable ingress storage;
// published batches own independent storage until their consumer has finished.
struct GxGpuCommandStorage {
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

	void copyPrefix(const GxGpuCommandStorage& source, size_t count) {
		serial = source.serial;
		commandCount = executedCommandCount = count;
		presentCommandCount = std::min(source.presentCommandCount, count);
		wordCount = count == 0u ? 0u : source.commandWordStart[count - 1u] + source.commandWordCount[count - 1u];
		std::copy_n(source.commandKind.begin(), count, commandKind.begin());
		std::copy_n(source.commandOpcode.begin(), count, commandOpcode.begin());
		std::copy_n(source.commandWordStart.begin(), count, commandWordStart.begin());
		std::copy_n(source.commandWordCount.begin(), count, commandWordCount.begin());
		std::copy_n(source.commandDrawModeWord.begin(), count, commandDrawModeWord.begin());
		std::copy_n(source.commandVramYAddressExtensionWord.begin(), count, commandVramYAddressExtensionWord.begin());
		std::copy_n(source.commandTextureWindowWord.begin(), count, commandTextureWindowWord.begin());
		std::copy_n(source.commandDrawingAreaTopLeftWord.begin(), count, commandDrawingAreaTopLeftWord.begin());
		std::copy_n(source.commandDrawingAreaBottomRightWord.begin(), count, commandDrawingAreaBottomRightWord.begin());
		std::copy_n(source.commandDrawingOffsetWord.begin(), count, commandDrawingOffsetWord.begin());
		std::copy_n(source.commandMaskBitModeWord.begin(), count, commandMaskBitModeWord.begin());
		std::copy_n(source.commandSkippedLineParity.begin(), count, commandSkippedLineParity.begin());
		std::copy_n(source.words.begin(), wordCount, words.begin());
	}
};

// The renderer produces bytes; only the device owner publishes their readiness.
struct GxGpuReadbackRequest {
	u32 x;
	u32 y;
	u32 width;
	u32 height;
	u8 vramYAddressExtensionWord;
};

} // namespace bmsx
