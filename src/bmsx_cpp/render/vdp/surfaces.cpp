#include "render/vdp/surfaces.h"

#include "machine/devices/vdp/fault.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/texture_transfer.h"
#include "rompack/format.h"
#include <string>

namespace bmsx {
namespace {

const char* resolveVdpSurfaceTextureKey(uint32_t surfaceId) {
	switch (surfaceId) {
		case VDP_RD_SURFACE_ENGINE: return ENGINE_ATLAS_TEXTURE_KEY;
		case VDP_RD_SURFACE_PRIMARY: return ATLAS_PRIMARY_SLOT_ID;
		case VDP_RD_SURFACE_SECONDARY: return ATLAS_SECONDARY_SLOT_ID;
		case VDP_RD_SURFACE_FRAMEBUFFER: return FRAMEBUFFER_RENDER_TEXTURE_KEY;
		default: break;
	}
	throw vdpFault("unknown VDP surface " + std::to_string(surfaceId) + ".");
}

} // namespace

VdpRenderSurfaceInfo resolveVdpRenderSurface(const VDP& vdp, uint32_t surfaceId) {
	const VdpBlitterSurfaceSize size = vdp.resolveBlitterSurfaceSize(surfaceId);
	return VdpRenderSurfaceInfo{
		resolveVdpSurfaceTextureKey(surfaceId),
		size.width,
		size.height,
	};
}

i32 resolveVdpSurfaceAtlasBinding(uint32_t surfaceId) {
	switch (surfaceId) {
		case VDP_RD_SURFACE_PRIMARY: return 0;
		case VDP_RD_SURFACE_SECONDARY: return 1;
		case VDP_RD_SURFACE_ENGINE: return ENGINE_ATLAS_INDEX;
		default: break;
	}
	throw vdpFault("surface " + std::to_string(surfaceId) + " cannot be sampled by the GLES2 blitter.");
}

bool isVdpFrameBufferSurface(uint32_t surfaceId) {
	return surfaceId == VDP_RD_SURFACE_FRAMEBUFFER;
}

TextureHandle getVdpRenderSurfaceTexture(uint32_t surfaceId) {
	if (isVdpFrameBufferSurface(surfaceId)) {
		return vdpRenderFrameBufferTexture();
	}
	return vdpTextureByUri(resolveVdpSurfaceTextureKey(surfaceId));
}

} // namespace bmsx
