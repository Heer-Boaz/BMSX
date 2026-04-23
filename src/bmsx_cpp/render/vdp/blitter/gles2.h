#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

struct VdpGles2Blitter {
	static bool execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue);
	static void invalidateFrameBufferAttachment();
	static void shutdown();
};

} // namespace bmsx
