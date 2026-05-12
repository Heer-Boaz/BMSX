#pragma once

#include "common/types.h"

namespace bmsx {

struct VdpSurfaceUpload;

struct VdpRenderSurfaceInfo {
	const char* textureKey = nullptr;
	uint32_t width = 0;
	uint32_t height = 0;
};

VdpRenderSurfaceInfo resolveVdpRenderSurfaceForUpload(const VdpSurfaceUpload& upload);
bool isVdpFrameBufferSurface(uint32_t surfaceId);

} // namespace bmsx
