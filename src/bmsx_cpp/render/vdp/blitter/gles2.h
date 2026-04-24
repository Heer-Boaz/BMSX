#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

struct VdpGles2Blitter {
	static void initialize();
	static bool execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue, f64 timeSeconds);
	static void invalidateFrameBufferAttachment();
	static void shutdown();
};

} // namespace bmsx
