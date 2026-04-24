#include "render/vdp/source_pixels.h"

#include "machine/devices/vdp/fault.h"
#include <string>

namespace bmsx {

VdpSourcePixels resolveVdpSurfacePixels(const VDP& vdp, u32 surfaceId) {
	for (const auto& slot : vdp.surfaceUploadSlots()) {
		if (slot.surfaceId == surfaceId) {
			return VdpSourcePixels{
				slot.cpuReadback.data(),
				slot.surfaceWidth,
				slot.surfaceHeight,
				slot.surfaceWidth * 4u,
			};
		}
	}
	throw vdpFault("surface " + std::to_string(surfaceId) + " is not registered for CPU readback.");
}

} // namespace bmsx
