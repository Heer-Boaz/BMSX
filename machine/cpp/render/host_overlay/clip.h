#pragma once

#include "common/primitives.h"
#include <algorithm>

namespace bmsx {

// Half-open bounds in the overlay lane's logical pixels.
struct HostOverlayClipRect {
	i32 left;
	i32 top;
	i32 right;
	i32 bottom;
};

// Render-target scissor, independent of UI nesting and primitive kind.
class HostOverlayClipState {
public:
	i32 left = 0;
	i32 top = 0;
	i32 right = 0;
	i32 bottom = 0;

	void reset(i32 logicalWidth, i32 logicalHeight, i32 width, i32 height) {
		this->logicalWidth = logicalWidth;
		this->logicalHeight = logicalHeight;
		this->width = width;
		this->height = height;
		left = 0;
		top = 0;
		right = width;
		bottom = height;
	}

	void set(const HostOverlayClipRect& clip) {
		left = std::max(0, std::min(width, static_cast<i32>(static_cast<f64>(clip.left) * width / logicalWidth)));
		top = std::max(0, std::min(height, static_cast<i32>(static_cast<f64>(clip.top) * height / logicalHeight)));
		right = std::max(left, std::min(width, static_cast<i32>(static_cast<f64>(clip.right) * width / logicalWidth)));
		bottom = std::max(top, std::min(height, static_cast<i32>(static_cast<f64>(clip.bottom) * height / logicalHeight)));
	}

private:
	i32 width = 0;
	i32 height = 0;
	i32 logicalWidth = 0;
	i32 logicalHeight = 0;
};

} // namespace bmsx
