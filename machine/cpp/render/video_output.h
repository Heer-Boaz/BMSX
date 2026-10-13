#pragma once

#include "common/primitives.h"
#include "common/rect.h"

namespace bmsx {

class VideoOutput {
public:
	VideoOutput(i32 width, i32 height)
		: visibleViewportBounds{0.0f, 0.0f, static_cast<f32>(width), static_cast<f32>(height), 0.0f} {}
	virtual ~VideoOutput() = default;
	// Half-open visible bounds in the full presentation target's logical pixels.
	RectBounds visibleViewportBounds;
	virtual void setDisplaySize(i32 width, i32 height) = 0;
};

} // namespace bmsx
