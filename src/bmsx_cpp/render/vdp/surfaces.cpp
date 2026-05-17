#include "render/vdp/surfaces.h"

#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/device_output.h"
#include "rompack/format.h"
#include <string>

namespace bmsx {
namespace {

const char* resolveVdpSurfaceTextureKey(uint32_t surfaceId) {
	switch (surfaceId) {
		case VDP_RD_SURFACE_SYSTEM: return SYSTEM_SLOT_TEXTURE_KEY;
		case VDP_RD_SURFACE_PRIMARY: return VDP_PRIMARY_SLOT_TEXTURE_KEY;
		case VDP_RD_SURFACE_SECONDARY: return VDP_SECONDARY_SLOT_TEXTURE_KEY;
	}
	throw BMSX_RUNTIME_ERROR("[VDPSurfaces] unknown surface " + std::to_string(surfaceId) + ".");
}

} // namespace

VdpRenderSurfaceInfo resolveVdpRenderSurfaceForUpload(const VdpSurfaceUpload& upload) {
	return VdpRenderSurfaceInfo{
		resolveVdpSurfaceTextureKey(upload.surfaceId),
		upload.surfaceWidth,
		upload.surfaceHeight,
	};
}

} // namespace bmsx
