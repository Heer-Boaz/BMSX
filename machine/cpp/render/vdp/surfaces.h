#pragma once

#include "common/types.h"

namespace bmsx {

struct VdpSurfaceUpload;

struct VdpRenderSurfaceInfo {
	const char* textureKey = nullptr;
	uint32_t width = 0;
	uint32_t height = 0;
};

const char* resolveVdpSurfaceTextureKey(uint32_t surfaceId);
VdpRenderSurfaceInfo resolveVdpRenderSurfaceForUpload(const VdpSurfaceUpload& upload);

} // namespace bmsx
