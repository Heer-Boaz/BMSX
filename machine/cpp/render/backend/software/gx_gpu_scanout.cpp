#include "render/backend/software/gx_gpu_scanout.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/backend.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {
namespace {

SoftwareBackend* g_gxGpuSoftwareScanoutBackend;

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

void fillOutputBlack() {
	const i32 pixelsPerRow = g_gxGpuSoftwareScanoutBackend->pitch() / static_cast<i32>(sizeof(u32));
	for (i32 y = 0; y < g_gxGpuSoftwareScanoutBackend->height(); y += 1) {
		u32* row = g_gxGpuSoftwareScanoutBackend->framebuffer() + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = 0; x < g_gxGpuSoftwareScanoutBackend->width(); x += 1) {
			row[x] = 0xff000000u;
		}
	}
}

} // namespace

void bindGxGpuSoftwareScanoutBackend(SoftwareBackend& backend) {
	g_gxGpuSoftwareScanoutBackend = &backend;
}

void scanoutGxGpuSoftwareVram(const GxGpuPipelineState& state) {
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u) {
		fillOutputBlack();
		return;
	}
	const u32 displayModeWord = state.displayModeWord;
	const i32 columns = gxGpuHorizontalVisibleColumns(state.horizontalDisplayRangeWord, displayModeWord);
	const i32 lines = gxGpuVerticalVisibleLines(state.verticalDisplayRangeWord, displayModeWord);
	const i32 displayStartX = static_cast<i32>(gxGpuDisplayStartX(state.displayStartWord));
	const i32 displayStartY = static_cast<i32>(gxGpuDisplayStartY(state.displayStartWord));
	const bool rgb24 = (displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) != 0u;
	const i32 targetWidth = g_gxGpuSoftwareScanoutBackend->width();
	const i32 targetHeight = g_gxGpuSoftwareScanoutBackend->height();
	const i32 pixelsPerRow = g_gxGpuSoftwareScanoutBackend->pitch() / static_cast<i32>(sizeof(u32));
	for (i32 outputY = 0; outputY < targetHeight; outputY += 1) {
		const i32 sourceY = displayStartY + (((outputY << 1) + 1) * lines) / (targetHeight << 1);
		u32* row = g_gxGpuSoftwareScanoutBackend->framebuffer() + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		for (i32 outputX = 0; outputX < targetWidth; outputX += 1) {
			const i32 sourceX = (((outputX << 1) + 1) * columns) / (targetWidth << 1);
			const u32 rgb = rgb24 ? rgb888AtSourcePixel(sourceX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + sourceX, sourceY);
			row[outputX] = packOutputArgb(rgb);
		}
	}
}

} // namespace bmsx
