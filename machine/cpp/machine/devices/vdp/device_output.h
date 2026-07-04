#pragma once

#include "common/types.h"
#include "machine/devices/vdp/rpu.h"
#include <vector>

namespace bmsx {

struct VdpSurfaceBacking {
	u32 baseAddr = 0u;
	u32 capacity = 0u;
	u32 surfaceId = 0u;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	std::vector<u8> cpuReadback;
};


struct VdpDeviceOutput {
	i32 ditherType = 0;
	u32 scanoutPhase = 0u;
	u32 scanoutX = 0u;
	u32 scanoutY = 0u;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
	const VdpRpuFrameOutput* rpu;
};

} // namespace bmsx
