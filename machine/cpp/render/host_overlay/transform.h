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

} // namespace bmsx
