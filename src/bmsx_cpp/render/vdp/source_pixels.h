#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

struct VdpSourcePixels {
	const u8* pixels = nullptr;
	u32 width = 0;
	u32 height = 0;
	u32 stride = 0;
};

VdpSourcePixels resolveVdpSurfacePixels(const VDP::VdpHostOutput& output, u32 surfaceId);

} // namespace bmsx
