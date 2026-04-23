#pragma once

#include "core/primitives.h"

namespace bmsx {

struct VdpFrameBufferSize {
	u32 width = 0;
	u32 height = 0;
};

VdpFrameBufferSize currentVdpFrameBufferSize();
bool vdpRenderFrameBufferTextureExists();
void ensureVdpDisplayFrameBufferTexture(const u8* seedPixel, u32 width, u32 height);
void swapVdpFrameBufferTexturePages();
void copyVdpRenderFrameBufferToDisplay(u32 width, u32 height);
void updateVdpRenderFrameBufferTexture(const u8* pixels, u32 width, u32 height);

} // namespace bmsx
