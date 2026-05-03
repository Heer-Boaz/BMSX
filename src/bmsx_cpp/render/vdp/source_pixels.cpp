#include "render/vdp/source_pixels.h"

#include "render/vdp/surfaces.h"

namespace bmsx {

VdpSourcePixels resolveVdpSurfacePixels(const VDP::VdpHostOutput& output, u32 surfaceId) {
	const VDP::VramSlot& slot = resolveVdpHostSurfaceSlot(output, surfaceId);
	return VdpSourcePixels{
		slot.cpuReadback.data(),
		slot.surfaceWidth,
		slot.surfaceHeight,
		slot.surfaceWidth * 4u,
	};
}

} // namespace bmsx
