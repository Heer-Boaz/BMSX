#pragma once

#include "common/primitives.h"

namespace bmsx {

// Host logical draw coordinates; independent of guest transforms and GPU registers.
struct HostOverlayTransform {
	f32 scale = 1.0F;
	f32 offsetX = 0.0F;
	f32 offsetY = 0.0F;
};

inline constexpr HostOverlayTransform IDENTITY_HOST_OVERLAY_TRANSFORM{};

// CPU raster boundary: compose logical scopes with the frame-to-target mapping.
struct HostOverlayRasterTransform {
	f32 viewportScaleX = 1.0F, viewportScaleY = 1.0F;
	f32 scaleX = 1.0F, scaleY = 1.0F, offsetX = 0.0F, offsetY = 0.0F;
	HostOverlayTransform logical;

	void reset(i32 logicalWidth, i32 logicalHeight, i32 width, i32 height) {
		viewportScaleX = static_cast<f32>(width) / static_cast<f32>(logicalWidth);
		viewportScaleY = static_cast<f32>(height) / static_cast<f32>(logicalHeight);
		set(IDENTITY_HOST_OVERLAY_TRANSFORM);
	}
	void set(const HostOverlayTransform& transform) {
		logical = transform;
		scaleX = transform.scale * viewportScaleX;
		scaleY = transform.scale * viewportScaleY;
		offsetX = transform.offsetX * viewportScaleX;
		offsetY = transform.offsetY * viewportScaleY;
	}
};

} // namespace bmsx
