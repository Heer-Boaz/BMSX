#pragma once

#include "common/primitives.h"

namespace bmsx {

constexpr u32 GX_GPU_RESET_DISPLAY_MODE_WORD = 0x00000009u;
constexpr u32 GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD = 0x00c60260u;
constexpr u32 GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD = 0x00044c23u;
constexpr u32 GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT = 0x04u;
constexpr u32 GX_GPU_DISPLAY_MODE_RGB24_BIT = 0x10u;
constexpr u32 GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 0x20u;
constexpr u32 GX_GPU_SCANOUT_INTERPRETATION_MASK = GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT | GX_GPU_DISPLAY_MODE_RGB24_BIT | GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT;

inline u32 gxGpuDisplayStartX(u32 word) {
	return word & 0x3ffu;
}

inline u32 gxGpuDisplayStartY(u32 word) {
	return (word >> 10u) & 0x1ffu;
}

inline u32 gxGpuScanoutField(u32 statusWord) {
	return ((statusWord >> 13u) ^ 1u) & 1u;
}

inline u32 gxGpuScanoutSourceLineStep(u32 displayModeWord) {
	if ((displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) == 0u) {
		return 0u;
	}
	return (displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT) != 0u ? 2u : 1u;
}

inline u32 gxGpuDisplayModeScreenWidth(u32 displayModeWord) {
	if ((displayModeWord & 0x40u) != 0u) {
		return 368u;
	}
	const u32 horizontalResolution1 = displayModeWord & 0x03u;
	if (horizontalResolution1 == 0u) {
		return 256u;
	}
	if (horizontalResolution1 == 1u) {
		return 320u;
	}
	if (horizontalResolution1 == 2u) {
		return 512u;
	}
	return 640u;
}

inline u32 gxGpuVerticalDisplayRangeStart(u32 verticalDisplayRangeWord) {
	return verticalDisplayRangeWord & 0x3ffu;
}

inline u32 gxGpuVerticalDisplayRangeEnd(u32 verticalDisplayRangeWord) {
	return (verticalDisplayRangeWord >> 10u) & 0x3ffu;
}

inline i32 gxGpuVerticalVisibleLines(u32 verticalDisplayRangeWord, u32 displayModeWord) {
	const i32 lines = static_cast<i32>(gxGpuVerticalDisplayRangeEnd(verticalDisplayRangeWord)) - static_cast<i32>(gxGpuVerticalDisplayRangeStart(verticalDisplayRangeWord));
	return (displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) != 0u ? lines * 2 : lines;
}

} // namespace bmsx
