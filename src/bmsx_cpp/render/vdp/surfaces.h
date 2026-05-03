#pragma once

#include "machine/devices/vdp/vdp.h"
#include "render/backend/backend.h"

namespace bmsx {

struct VdpRenderSurfaceInfo {
	const char* textureKey = nullptr;
	uint32_t width = 0;
	uint32_t height = 0;
};

const VDP::VramSlot& resolveVdpHostSurfaceSlot(const VDP::VdpHostOutput& output, uint32_t surfaceId);
VdpRenderSurfaceInfo resolveVdpRenderSurface(const VDP::VdpHostOutput& output, uint32_t surfaceId);
u32 resolveVdpSurfaceSlotBinding(uint32_t surfaceId);
bool isVdpFrameBufferSurface(uint32_t surfaceId);
TextureHandle getVdpRenderSurfaceTexture(uint32_t surfaceId);

} // namespace bmsx
