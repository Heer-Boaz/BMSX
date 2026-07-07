#include "render/backend/software/gx_gpu.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cstddef>

namespace bmsx {
namespace {

constexpr size_t kGxGpuSoftwareVramWords = static_cast<size_t>(GX_GPU_VRAM_WIDTH) * static_cast<size_t>(GX_GPU_VRAM_HEIGHT);
constexpr u32 kGxGpuDisplayModeRgb24Bit = 0x10u;
constexpr u32 kGxGpuDisplayModePalBit = 0x08u;
constexpr u32 kGxGpuDisplayModeVerticalResolutionBit = 0x04u;
constexpr u32 kGxGpuDisplayModeVerticalInterlaceBit = 0x20u;
constexpr i32 kGxGpuScanoutNtscOverscanLeft = 608;
constexpr i32 kGxGpuScanoutPalOverscanLeft = 638;
constexpr i32 kGxGpuScanoutNtscOverscanTop = 16;
constexpr i32 kGxGpuScanoutPalOverscanTop = 35;

std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareVram{};
std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareCopyScratch{};
size_t g_gxGpuSoftwareProcessedCommandCount = 0u;
u32 g_gxGpuSoftwareProcessedCommandSerial = 0u;

inline size_t vramIndex(i32 x, i32 y) {
	const u32 wrappedX = static_cast<u32>(x) & (GX_GPU_VRAM_WIDTH - 1u);
	const u32 wrappedY = static_cast<u32>(y) & (GX_GPU_VRAM_HEIGHT - 1u);
	return static_cast<size_t>(wrappedY) * static_cast<size_t>(GX_GPU_VRAM_WIDTH) + static_cast<size_t>(wrappedX);
}

inline u16 rgb888WordToRgb555(u32 word) {
	return static_cast<u16>(((word & 0xffu) >> 3u)
		| ((((word >> 8u) & 0xffu) >> 3u) << 5u)
		| ((((word >> 16u) & 0xffu) >> 3u) << 10u));
}

inline u8 rgb555ChannelTo8(u32 channel) {
	return static_cast<u8>((channel << 3u) | (channel >> 2u));
}

inline void writeMaskedVramWord(size_t index, u32 word, u32 maskBitModeWord) {
	const u16 dstWord = g_gxGpuSoftwareVram[index];
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) && (dstWord & 0x8000u) != 0u) {
		return;
	}
	const u32 maskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 0x8000u : word & 0x8000u;
	g_gxGpuSoftwareVram[index] = static_cast<u16>((word & 0x7fffu) | maskBit);
}

inline bool interlacedFillSkipsLine(i32 y, u32 interlacedRenderWord) {
	return (interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) != 0u
		&& (static_cast<u32>(y) & 1u) == ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB) >> 1u);
}

void executeFillRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u16 colorWord = rgb888WordToRgb555(commandBuffer.words[wordStart]);
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const i32 x = static_cast<i32>(gxGpuFillX(xyWord));
	const i32 y = static_cast<i32>(gxGpuTransferY(xyWord));
	const i32 width = static_cast<i32>(gxGpuFillWidth(sizeWord));
	const i32 height = static_cast<i32>(gxGpuFillHeight(sizeWord));
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (i32 row = 0; row < height; row += 1) {
		const i32 targetY = (y + row) & static_cast<i32>(GX_GPU_VRAM_HEIGHT - 1u);
		if (interlacedFillSkipsLine(targetY, interlacedRenderWord)) {
			continue;
		}
		for (i32 column = 0; column < width; column += 1) {
			g_gxGpuSoftwareVram[vramIndex(x + column, targetY)] = colorWord;
		}
	}
}

void executeCpuToVram(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const i32 x = static_cast<i32>(gxGpuTransferX(xyWord));
	const i32 y = static_cast<i32>(gxGpuTransferY(xyWord));
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 emittedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	u32 emittedPixel = 0u;
	for (u32 row = 0u; row < height && emittedPixel < emittedPixels; row += 1u) {
		const u32 rowRemaining = emittedPixels - emittedPixel;
		const u32 rowWidth = rowRemaining < width ? rowRemaining : width;
		const i32 targetY = (y + static_cast<i32>(row)) & static_cast<i32>(GX_GPU_VRAM_HEIGHT - 1u);
		for (u32 column = 0u; column < rowWidth; column += 1u) {
			const u32 payloadWord = commandBuffer.words[payloadWordStart + (emittedPixel >> 1u)];
			writeMaskedVramWord(vramIndex(x + static_cast<i32>(column), targetY), gxGpuTransferPixelWord(payloadWord, emittedPixel), maskBitModeWord);
			emittedPixel += 1u;
		}
	}
}

void copyVramArea(i32 sourceX, i32 sourceY, i32 targetX, i32 targetY, u32 width, u32 height, u32 maskBitModeWord) {
	size_t scratchIndex = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const i32 rowSourceY = sourceY + static_cast<i32>(row);
		for (u32 column = 0u; column < width; column += 1u) {
			g_gxGpuSoftwareCopyScratch[scratchIndex] = g_gxGpuSoftwareVram[vramIndex(sourceX + static_cast<i32>(column), rowSourceY)];
			scratchIndex += 1u;
		}
	}
	scratchIndex = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const i32 rowTargetY = targetY + static_cast<i32>(row);
		for (u32 column = 0u; column < width; column += 1u) {
			writeMaskedVramWord(vramIndex(targetX + static_cast<i32>(column), rowTargetY), g_gxGpuSoftwareCopyScratch[scratchIndex], maskBitModeWord);
			scratchIndex += 1u;
		}
	}
}

void executeVramToVram(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	copyVramArea(
		static_cast<i32>(gxGpuTransferX(sourceWord)),
		static_cast<i32>(gxGpuTransferY(sourceWord)),
		static_cast<i32>(gxGpuTransferX(targetWord)),
		static_cast<i32>(gxGpuTransferY(targetWord)),
		gxGpuTransferWidth(sizeWord),
		gxGpuTransferHeight(sizeWord),
		commandBuffer.commandMaskBitModeWord[commandIndex]);
}

void executeGxGpuSoftwareCommands(const GxGpuCommandBuffer& commandBuffer) {
	for (size_t commandIndex = g_gxGpuSoftwareProcessedCommandCount; commandIndex < commandBuffer.commandCount; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				executeFillRectangle(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				executeVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				executeCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	g_gxGpuSoftwareProcessedCommandCount = commandBuffer.commandCount;
}

inline i32 displayModeScreenHeight(u32 displayModeWord) {
	const bool highVerticalResolution = (displayModeWord & kGxGpuDisplayModeVerticalResolutionBit) != 0u;
	if ((displayModeWord & kGxGpuDisplayModePalBit) != 0u) {
		return highVerticalResolution ? 512 : 256;
	}
	return highVerticalResolution ? 480 : 240;
}

inline i32 screenXForOutputPixel(i32 outputX, i32 targetWidth, i32 screenWidth) {
	return (((outputX << 1) + 1) * screenWidth) / (targetWidth << 1);
}

inline i32 screenYForOutputPixel(i32 outputY, i32 targetHeight, i32 screenHeight) {
	return (((outputY << 1) + 1) * screenHeight) / (targetHeight << 1);
}

inline i32 visibleColumns(u32 horizontalDisplayRangeWord, u32 dotClockDivider) {
	const i32 rangeCycles = static_cast<i32>(gxGpuHorizontalDisplayRangeEnd(horizontalDisplayRangeWord))
		- static_cast<i32>(gxGpuHorizontalDisplayRangeStart(horizontalDisplayRangeWord));
	const i32 columns = (rangeCycles / static_cast<i32>(dotClockDivider)) + 2;
	return columns & ~0x03;
}

inline u32 rgb888AtSourcePixel(i32 sourceX, i32 sourceY, i32 displayStartX) {
	const i32 wordX = displayStartX + (sourceX * 3) / 2;
	const u32 word0 = g_gxGpuSoftwareVram[vramIndex(wordX, sourceY)];
	const u32 word1 = g_gxGpuSoftwareVram[vramIndex(wordX + 1, sourceY)];
	if ((sourceX & 1) == 0) {
		return (word0 & 0xffu) | ((word0 >> 8u) << 8u) | ((word1 & 0xffu) << 16u);
	}
	return (word0 >> 8u) | ((word1 & 0xffu) << 8u) | (((word1 >> 8u) & 0xffu) << 16u);
}

inline u32 rgb555AtSourcePixel(i32 sourceX, i32 sourceY) {
	const u32 word = g_gxGpuSoftwareVram[vramIndex(sourceX, sourceY)];
	return static_cast<u32>(rgb555ChannelTo8(word & 0x1fu))
		| (static_cast<u32>(rgb555ChannelTo8((word >> 5u) & 0x1fu)) << 8u)
		| (static_cast<u32>(rgb555ChannelTo8((word >> 10u) & 0x1fu)) << 16u);
}

inline u32 packOutputArgb(u32 rgb) {
	return 0xff000000u | ((rgb & 0xffu) << 16u) | (rgb & 0x00ff00u) | ((rgb >> 16u) & 0xffu);
}

void fillOutputBlack(SoftwareBackend& backend) {
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 y = 0; y < backend.height(); y += 1) {
		u32* row = backend.framebuffer() + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = 0; x < backend.width(); x += 1) {
			row[x] = 0xff000000u;
		}
	}
}

void scanoutGxGpuSoftwareVram(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u) {
		fillOutputBlack(backend);
		return;
	}
	const u32 displayModeWord = state.displayModeWord;
	const i32 screenWidth = static_cast<i32>(gxGpuDisplayModeScreenWidth(displayModeWord));
	const i32 screenHeight = displayModeScreenHeight(displayModeWord);
	const u32 dotClockDivider = gxGpuDisplayModeDotClockDivider(displayModeWord);
	const i32 horizontalStart = static_cast<i32>(gxGpuHorizontalDisplayRangeStart(state.horizontalDisplayRangeWord));
	const i32 verticalStart = static_cast<i32>(state.verticalDisplayRangeWord & 0x3ffu);
	const i32 verticalEnd = static_cast<i32>((state.verticalDisplayRangeWord >> 10u) & 0x3ffu);
	const i32 overscanLeft = (displayModeWord & kGxGpuDisplayModePalBit) != 0u ? kGxGpuScanoutPalOverscanLeft : kGxGpuScanoutNtscOverscanLeft;
	const i32 overscanTop = (displayModeWord & kGxGpuDisplayModePalBit) != 0u ? kGxGpuScanoutPalOverscanTop : kGxGpuScanoutNtscOverscanTop;
	i32 originLeft = (horizontalStart - overscanLeft) / static_cast<i32>(dotClockDivider);
	i32 sourceSkipX = 0;
	i32 columns = visibleColumns(state.horizontalDisplayRangeWord, dotClockDivider);
	if (originLeft < 0) {
		sourceSkipX = -originLeft;
		columns += originLeft;
		originLeft = 0;
	}
	const i32 maxColumns = screenWidth - originLeft;
	if (columns > maxColumns) {
		columns = maxColumns;
	}
	i32 originTop = verticalStart - overscanTop;
	i32 sourceSkipY = 0;
	i32 lines = verticalEnd - verticalStart;
	if (originTop < 0) {
		sourceSkipY = -originTop;
		lines += originTop;
		originTop = 0;
	}
	if ((displayModeWord & kGxGpuDisplayModeVerticalInterlaceBit) != 0u) {
		lines <<= 1;
	}
	const i32 maxLines = screenHeight - originTop;
	if (lines > maxLines) {
		lines = maxLines;
	}
	const i32 displayStartX = static_cast<i32>(gxGpuDisplayStartX(state.displayStartWord));
	const i32 displayStartY = static_cast<i32>(gxGpuDisplayStartY(state.displayStartWord));
	const bool rgb24 = (displayModeWord & kGxGpuDisplayModeRgb24Bit) != 0u;
	const i32 targetWidth = backend.width();
	const i32 targetHeight = backend.height();
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 outputY = 0; outputY < targetHeight; outputY += 1) {
		const i32 screenY = screenYForOutputPixel(outputY, targetHeight, screenHeight);
		u32* row = backend.framebuffer() + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		for (i32 outputX = 0; outputX < targetWidth; outputX += 1) {
			const i32 screenX = screenXForOutputPixel(outputX, targetWidth, screenWidth);
			u32 rgb = 0u;
			if (screenX >= originLeft && screenY >= originTop && screenX < originLeft + columns && screenY < originTop + lines) {
				const i32 sourceX = sourceSkipX + screenX - originLeft;
				const i32 sourceY = displayStartY + sourceSkipY + screenY - originTop;
				rgb = rgb24 ? rgb888AtSourcePixel(sourceX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + sourceX, sourceY);
			}
			row[outputX] = packOutputArgb(rgb);
		}
	}
}

void executeGxGpuSoftwarePass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& stateStorage, void*) {
	auto& typedBackend = *static_cast<SoftwareBackend*>(backend);
	renderGxGpuSoftwareFrame(typedBackend, stateStorage.gxGpu);
}

} // namespace

void renderGxGpuSoftwareFrame(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	if (g_gxGpuSoftwareProcessedCommandSerial != state.commandBuffer->serial) {
		g_gxGpuSoftwareVram.fill(0u);
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = state.commandBuffer->serial;
	}
	executeGxGpuSoftwareCommands(*state.commandBuffer);
	scanoutGxGpuSoftwareVram(backend, state);
}

void registerGxGpuPassSoftware(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.exec = executeGxGpuSoftwarePass;
	registry.registerPass(desc);
}

} // namespace bmsx
