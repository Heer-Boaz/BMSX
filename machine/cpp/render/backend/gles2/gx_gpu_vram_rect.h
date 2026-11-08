#pragma once

#include "common/primitives.h"
#include "spec/gx/vram.h"

namespace bmsx {

struct GxGpuVramCopyRect {
	i32 left = 0;
	i32 top = 0;
	i32 right = 0;
	i32 bottom = 0;
};

inline void resetGxGpuVramCopyRect(GxGpuVramCopyRect& rect) {
	rect = {static_cast<i32>(GX_GPU_VRAM_X_ADDRESS_PERIOD), static_cast<i32>(GX_GPU_VRAM_Y_ADDRESS_PERIOD), 0, 0};
}

inline void includeGxGpuVramCopyVertex(GxGpuVramCopyRect& rect, i32 x, i32 y) {
	if (x < rect.left) rect.left = x;
	if (y < rect.top) rect.top = y;
	if (x + 1 > rect.right) rect.right = x + 1;
	if (y + 1 > rect.bottom) rect.bottom = y + 1;
}

inline void includeGxGpuVramCopyRect(GxGpuVramCopyRect& target, const GxGpuVramCopyRect& source) {
	if (target.right <= target.left || target.bottom <= target.top) { target = source; return; }
	if (source.right <= source.left || source.bottom <= source.top) return;
	if (source.left < target.left) target.left = source.left;
	if (source.top < target.top) target.top = source.top;
	if (source.right > target.right) target.right = source.right;
	if (source.bottom > target.bottom) target.bottom = source.bottom;
}

inline bool gxGpuPhysicalVramRectsOverlap(const GxGpuVramCopyRect& a, const GxGpuVramCopyRect& b) {
	return a.right > a.left && a.bottom > a.top && b.right > b.left && b.bottom > b.top
		&& a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

} // namespace bmsx
