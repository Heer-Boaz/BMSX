#include "render/backend/software/gx_gpu_commands.h"

#include "machine/devices/gx/gpu_command_storage.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/gx_gpu_upload_profile.h"
#include "render/backend/software/gx_gpu_rasterizer.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <bit>
#include <chrono>
#include <cstring>

namespace bmsx {
namespace {

void executeFillRectangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u16 colorWord = gxGpuSoftwareRgb888WordToRgb555(commandBuffer.words[wordStart]);
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 x = static_cast<i32>(gxGpuFillX(xyWord));
	const u32 y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	const u32 width = gxGpuFillWidth(sizeWord);
	const u32 first = std::min(width, GX_GPU_VRAM_X_ADDRESS_PERIOD - static_cast<u32>(x));
	const i32 height = static_cast<i32>(gxGpuFillHeight(sizeWord));
	const i32 skippedLineParity = static_cast<i32>(commandBuffer.commandSkippedLineParity[commandIndex]);
	for (i32 row = 0; row < height; row += 1) {
		const u32 targetY = gxGpuVramYAddress(y + static_cast<u32>(row), vramYAddressExtensionWord);
		if (static_cast<i32>(targetY & 1u) == skippedLineParity) {
			continue;
		}
		auto* line = software.vram.data() + gxGpuSoftwareVramIndex(software, 0, static_cast<i32>(targetY));
		std::fill_n(line + x, first, colorWord);
		if (first != width) std::fill_n(line, width - first, colorWord);
	}
}

u32 executeCpuToVram(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const i32 x = static_cast<i32>(gxGpuTransferX(xyWord));
	const u32 y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 emittedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	u32 emittedPixel = 0u;
	for (u32 row = 0u; row < height && emittedPixel < emittedPixels; row += 1u) {
		const u32 rowRemaining = emittedPixels - emittedPixel;
		const u32 rowWidth = rowRemaining < width ? rowRemaining : width;
		const u32 targetY = gxGpuVramYAddress(y + row, vramYAddressExtensionWord);
		if constexpr (std::endian::native == std::endian::little) {
			if (!checkMaskBit && !setMaskBit) {
				// Raw upload words already contain the two VRAM pixels in order.
				// Split only at X wrap; an odd row continues in the same payload word.
				const u32 first = std::min(rowWidth, GX_GPU_VRAM_X_ADDRESS_PERIOD - static_cast<u32>(x));
				const size_t target = gxGpuSoftwareVramIndex(software, x, static_cast<i32>(targetY));
				const u8* source = reinterpret_cast<const u8*>(commandBuffer.words.data() + payloadWordStart)
					+ emittedPixel * sizeof(u16);
				std::memcpy(software.vram.data() + target, source, first * sizeof(u16));
				if (first != rowWidth) {
					std::memcpy(software.vram.data() + target - x, source + first * sizeof(u16), (rowWidth - first) * sizeof(u16));
				}
				emittedPixel += rowWidth;
				continue;
			}
		}
		for (u32 column = 0u; column < rowWidth; column += 1u) {
			const u32 payloadWord = commandBuffer.words[payloadWordStart + (emittedPixel >> 1u)];
			gxGpuSoftwareWriteMaskedVramWord(
				software,
				gxGpuSoftwareVramIndex(
					software,
					x + static_cast<i32>(column),
					static_cast<i32>(targetY)),
				gxGpuTransferPixelWord(payloadWord, emittedPixel),
				checkMaskBit,
				setMaskBit);
			emittedPixel += 1u;
		}
	}
	return emittedPixels;
}

void copyVramArea(
	GxGpuSoftwareState& software,
	i32 sourceX,
	u32 sourceY,
	i32 targetX,
	u32 targetY,
	u32 width,
	u32 height,
	u32 maskBitModeWord,
	u32 vramYAddressExtensionWord) {
	const bool checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const bool setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	constexpr i32 xAddressMask = static_cast<i32>(GX_GPU_VRAM_X_ADDRESS_PERIOD) - 1;
	const u32 sourceToTargetDistance = static_cast<u32>(targetX - sourceX) & static_cast<u32>(xAddressMask);
	const bool copyBackwards = sourceToTargetDistance != 0u && sourceToTargetDistance < width;
	const i32 firstColumn = copyBackwards ? static_cast<i32>(width) - 1 : 0;
	const i32 lastColumn = copyBackwards ? -1 : static_cast<i32>(width);
	const i32 columnStep = copyBackwards ? -1 : 1;
	for (u32 row = 0u; row < height; row += 1u) {
		const u32 rowSourceY = gxGpuVramYAddress(sourceY + row, vramYAddressExtensionWord);
		const u32 rowTargetY = gxGpuVramYAddress(targetY + row, vramYAddressExtensionWord);
		for (i32 column = firstColumn; column != lastColumn; column += columnStep) {
			const u16 sourceWord = software.vram[
				gxGpuSoftwareVramIndex(
					software,
					sourceX + column,
					static_cast<i32>(rowSourceY))];
			gxGpuSoftwareWriteMaskedVramWord(
				software,
				gxGpuSoftwareVramIndex(
					software,
					targetX + column,
					static_cast<i32>(rowTargetY)),
				sourceWord,
				checkMaskBit,
				setMaskBit);
		}
	}
}

void executeVramToVram(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	const u32 vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	copyVramArea(
		software,
		static_cast<i32>(gxGpuTransferX(sourceWord)),
		gxGpuTransferY(sourceWord, vramYAddressExtensionWord),
		static_cast<i32>(gxGpuTransferX(targetWord)),
		gxGpuTransferY(targetWord, vramYAddressExtensionWord),
		gxGpuTransferWidth(sizeWord),
		gxGpuTransferHeight(sizeWord),
		commandBuffer.commandMaskBitModeWord[commandIndex],
		vramYAddressExtensionWord);
}

void executeDrawPolygon(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 positionStride = commandBuffer.drawPositionStride[record];
	const u32 colorStride = commandBuffer.drawColorStride[record];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool ditherEnabled = gxGpuDitheredPolygon(commandBuffer.commandDrawModeWord[commandIndex], opcode);
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 xy1 = commandBuffer.words[wordStart + 1u + positionStride];
	const u32 xy2 = commandBuffer.words[wordStart + 1u + positionStride * 2u];
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 color1 = commandBuffer.words[wordStart + colorStride];
	const u32 color2 = commandBuffer.words[wordStart + colorStride * 2u];
	if (gxGpuCommandTextureEnabled(opcode)) {
		const u32 texture0 = commandBuffer.words[wordStart + 2u];
		const u32 texture1 = commandBuffer.words[wordStart + 2u + positionStride];
		const u32 texture2 = commandBuffer.words[wordStart + 2u + positionStride * 2u];
		drawGxGpuSoftwareTexturedTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), ditherEnabled);
		if (commandBuffer.drawVertexCount[record] == 4u) {
			const u32 xy3 = commandBuffer.words[wordStart + 1u + positionStride * 3u];
			const u32 color3 = commandBuffer.words[wordStart + colorStride * 3u];
			const u32 texture3 = commandBuffer.words[wordStart + 2u + positionStride * 3u];
			drawGxGpuSoftwareTexturedTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3), ditherEnabled);
		}
		return;
	}
	drawGxGpuSoftwareTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
	if (commandBuffer.drawVertexCount[record] == 4u) {
		const u32 xy3 = commandBuffer.words[wordStart + 1u + positionStride * 3u];
		const u32 color3 = commandBuffer.words[wordStart + colorStride * 3u];
		drawGxGpuSoftwareTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
	}
}

void executeDrawRectangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.drawSizeOffset[commandBuffer.commandDrawIndex[commandIndex]]];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 x = gxGpuSigned11(static_cast<u32>(gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord)));
	const i32 y = gxGpuSigned11(static_cast<u32>(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord)));
	if (gxGpuCommandTextureEnabled(opcode)) {
		drawGxGpuSoftwareTexturedRectangle(software, commandBuffer, commandIndex, x, y, width, height, colorWord, commandBuffer.words[wordStart + 2u]);
		return;
	}
	drawGxGpuSoftwareRectangle(software, commandBuffer, commandIndex, x, y, width, height, colorWord);
}

void executeDrawLine(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 positionStride = commandBuffer.drawPositionStride[record];
	const u32 colorStride = commandBuffer.drawColorStride[record];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 color1 = commandBuffer.words[wordStart + colorStride];
	const u32 xy1 = commandBuffer.words[wordStart + 1u + positionStride];
	drawGxGpuSoftwareLineSegment(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
}

void executeDrawPolyline(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 record = commandBuffer.commandDrawIndex[commandIndex];
	const u32 positionStride = commandBuffer.drawPositionStride[record];
	const u32 colorStride = commandBuffer.drawColorStride[record];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuSigned11(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	u32 color0 = commandBuffer.words[wordStart];
	u32 xy0 = commandBuffer.words[wordStart + 1u];
	for (u32 vertex = 1u; vertex < commandBuffer.drawVertexCount[record]; ++vertex) {
		const u32 color1 = commandBuffer.words[wordStart + vertex * colorStride];
		const u32 xy1 = commandBuffer.words[wordStart + 1u + vertex * positionStride];
		drawGxGpuSoftwareLineSegment(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		color0 = color1;
		xy0 = xy1;
	}
}

template<bool Profile>
size_t executeCommands(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t processedCommandCount,
	size_t commandLimit,
	GxUploadProfileFrame* profile) {
	for (size_t commandIndex = processedCommandCount; commandIndex < commandLimit; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
				executeDrawPolygon(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_LINE:
				executeDrawLine(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_POLYLINE:
				executeDrawPolyline(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_RECTANGLE:
				executeDrawRectangle(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				executeFillRectangle(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				executeVramToVram(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				if constexpr (Profile) {
					const auto start = std::chrono::steady_clock::now();
					const u32 pixels = executeCpuToVram(software, commandBuffer, commandIndex);
					const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(
						std::chrono::steady_clock::now() - start).count();
					profile->recordCpuToVram(static_cast<u64>(pixels) * sizeof(u16), 0u, 0u, static_cast<u64>(elapsed));
				} else {
					executeCpuToVram(software, commandBuffer, commandIndex);
				}
				break;
		}
	}
	return processedCommandCount < commandLimit ? commandLimit : processedCommandCount;
}

} // namespace

size_t executeGxGpuSoftwareCommands(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t processedCommandCount,
	size_t commandLimit,
	GxUploadProfileFrame* profile) {
	if (profile != nullptr) {
		return executeCommands<true>(software, commandBuffer, processedCommandCount, commandLimit, profile);
	}
	return executeCommands<false>(software, commandBuffer, processedCommandCount, commandLimit, nullptr);
}

} // namespace bmsx
