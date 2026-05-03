#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

struct VdpGles2Blitter {
	static void initialize();
	static bool execute(const VDP::VdpHostOutput& output, const std::vector<VDP::BlitterCommand>& queue);
	static void invalidateFrameBufferAttachment();
	static void shutdown();
};

} // namespace bmsx
