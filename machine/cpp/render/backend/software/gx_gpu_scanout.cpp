#include "render/backend/software/gx_gpu_scanout.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/backend.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <algorithm>
#include <cstring>
#include <vector>

namespace bmsx {
namespace {

struct InterlacedScanoutState {
	std::vector<u32> pixels;
	i32 width = 0;
	i32 height = 0;
	u32 displayStartWord = 0u;
	u32 interpretationWord = 0u;
	u64 vramSnapshotSerial = 0u;
	bool valid = false;
};

InterlacedScanoutState g_interlacedScanout;

inline u32 rgb888AtSourcePixel(i32 sourceX, i32 sourceY, i32 displayStartX) {
	const i32 wordX = displayStartX + ((sourceX * 3) >> 1);
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

void writeInterlacedField(
	const GxGpuPipelineState& state,
	u32 field,
	u32 sourceLineStep,
	i32 displayStartX,
	i32 displayStartY,
	bool rgb24,
	bool displayDisabled
) {
	const i32 width = state.width;
	const i32 fieldHeight = state.height >> 1;
	i32 sourceY = displayStartY + static_cast<i32>(field * (sourceLineStep - 1u));
	for (i32 fieldLine = 0; fieldLine < fieldHeight; fieldLine += 1) {
		u32* const row = g_interlacedScanout.pixels.data()
			+ static_cast<size_t>((fieldLine << 1) + static_cast<i32>(field)) * static_cast<size_t>(width);
		if (displayDisabled) {
			std::fill_n(row, width, 0xff000000u);
		} else {
			for (i32 outputX = 0; outputX < width; outputX += 1) {
				const u32 rgb = rgb24 ? rgb888AtSourcePixel(outputX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + outputX, sourceY);
				row[outputX] = packOutputArgb(rgb);
			}
		}
		sourceY += static_cast<i32>(sourceLineStep);
	}
}

void copyInterlacedScanout(SoftwareBackend& backend, i32 width, i32 height) {
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 y = 0; y < height; y += 1) {
		u32* const target = backend.framebuffer() + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow);
		const u32* const source = g_interlacedScanout.pixels.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
		std::memcpy(target, source, static_cast<size_t>(width) * sizeof(u32));
	}
}

void scanoutInterlacedVram(SoftwareBackend& backend, const GxGpuPipelineState& state, u32 sourceLineStep) {
	const i32 width = backend.width();
	const i32 height = backend.height();
	const u32 interpretationWord = state.displayModeWord & GX_GPU_SCANOUT_INTERPRETATION_MASK;
	const bool invalid = !g_interlacedScanout.valid
		|| g_interlacedScanout.width != width
		|| g_interlacedScanout.height != height
		|| g_interlacedScanout.displayStartWord != state.displayStartWord
		|| g_interlacedScanout.interpretationWord != interpretationWord
		|| g_interlacedScanout.vramSnapshotSerial != state.vramSnapshotSerial;
	const size_t pixelCount = static_cast<size_t>(width) * static_cast<size_t>(height);
	if (g_interlacedScanout.pixels.size() != pixelCount) {
		g_interlacedScanout.pixels.resize(pixelCount);
	}
	const i32 displayStartX = static_cast<i32>(gxGpuDisplayStartX(state.displayStartWord));
	const i32 displayStartY = static_cast<i32>(gxGpuDisplayStartY(state.displayStartWord));
	const bool rgb24 = (state.displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) != 0u;
	const bool displayDisabled = (state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u;
	if (invalid) {
		writeInterlacedField(state, 0u, sourceLineStep, displayStartX, displayStartY, rgb24, displayDisabled);
		writeInterlacedField(state, 1u, sourceLineStep, displayStartX, displayStartY, rgb24, displayDisabled);
		g_interlacedScanout.width = width;
		g_interlacedScanout.height = height;
		g_interlacedScanout.displayStartWord = state.displayStartWord;
		g_interlacedScanout.interpretationWord = interpretationWord;
		g_interlacedScanout.vramSnapshotSerial = state.vramSnapshotSerial;
		g_interlacedScanout.valid = true;
	} else {
		writeInterlacedField(state, gxGpuScanoutField(state.statusWord), sourceLineStep, displayStartX, displayStartY, rgb24, displayDisabled);
	}
	copyInterlacedScanout(backend, width, height);
}

} // namespace

void scanoutGxGpuSoftwareVram(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	const u32 sourceLineStep = gxGpuScanoutSourceLineStep(state.displayModeWord);
	if (sourceLineStep != 0u) {
		scanoutInterlacedVram(backend, state, sourceLineStep);
		return;
	}
	g_interlacedScanout.valid = false;
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u) {
		fillOutputBlack(backend);
		return;
	}
	const u32 displayModeWord = state.displayModeWord;
	const i32 displayStartX = static_cast<i32>(gxGpuDisplayStartX(state.displayStartWord));
	const i32 displayStartY = static_cast<i32>(gxGpuDisplayStartY(state.displayStartWord));
	const bool rgb24 = (displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) != 0u;
	const i32 targetWidth = backend.width();
	const i32 targetHeight = backend.height();
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 outputY = 0; outputY < targetHeight; outputY += 1) {
		const i32 sourceY = displayStartY + outputY;
		u32* row = backend.framebuffer() + static_cast<size_t>(outputY) * static_cast<size_t>(pixelsPerRow);
		for (i32 outputX = 0; outputX < targetWidth; outputX += 1) {
			const u32 rgb = rgb24 ? rgb888AtSourcePixel(outputX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + outputX, sourceY);
			row[outputX] = packOutputArgb(rgb);
		}
	}
}

} // namespace bmsx
