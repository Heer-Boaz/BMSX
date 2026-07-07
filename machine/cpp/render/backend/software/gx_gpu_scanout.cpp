#include "render/backend/software/gx_gpu_scanout.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/backend.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {
namespace {

constexpr u32 kGxGpuDisplayModeRgb24Bit = 0x10u;
constexpr u32 kGxGpuDisplayModePalBit = 0x08u;
constexpr u32 kGxGpuDisplayModeVerticalResolutionBit = 0x04u;
constexpr u32 kGxGpuDisplayModeVerticalInterlaceBit = 0x20u;
constexpr i32 kGxGpuScanoutNtscOverscanLeft = 608;
constexpr i32 kGxGpuScanoutPalOverscanLeft = 638;
constexpr i32 kGxGpuScanoutNtscOverscanTop = 16;
constexpr i32 kGxGpuScanoutPalOverscanTop = 35;

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
	const u32 word0 = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(wordX, sourceY)];
	const u32 word1 = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(wordX + 1, sourceY)];
	if ((sourceX & 1) == 0) {
		return (word0 & 0xffu) | ((word0 >> 8u) << 8u) | ((word1 & 0xffu) << 16u);
	}
	return (word0 >> 8u) | ((word1 & 0xffu) << 8u) | (((word1 >> 8u) & 0xffu) << 16u);
}

inline u32 rgb555AtSourcePixel(i32 sourceX, i32 sourceY) {
	const u32 word = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(sourceX, sourceY)];
	return static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8(word & 0x1fu))
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 5u) & 0x1fu)) << 8u)
		| (static_cast<u32>(gxGpuSoftwareRgb555ChannelTo8((word >> 10u) & 0x1fu)) << 16u);
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

} // namespace

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

} // namespace bmsx
