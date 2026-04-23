#pragma once

#include "core/primitives.h"

namespace bmsx {

bool vdpRenderFrameBufferTextureExists();
void ensureVdpDisplayFrameBufferTexture(const u8* seedPixel, u32 width, u32 height);
void swapVdpFrameBufferTexturePages();
void copyVdpRenderFrameBufferToDisplay(u32 width, u32 height);
void updateVdpRenderFrameBufferTexture(const u8* pixels, u32 width, u32 height);
void readVdpRenderFrameBufferTextureRegion(u8* out, i32 width, i32 height, i32 x, i32 y);

} // namespace bmsx
