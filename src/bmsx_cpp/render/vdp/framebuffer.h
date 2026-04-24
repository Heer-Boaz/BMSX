#pragma once

#include "core/primitives.h"
#include "render/backend/backend.h"

namespace bmsx {

class VDP;

bool hasVdpFrameBufferTexture();
TextureHandle getVdpDisplayFrameBufferTexture();
TextureHandle getVdpRenderFrameBufferTexture();
void syncVdpDisplayFrameBuffer(VDP& vdp, const u8* seedPixel);
void presentVdpFrameBufferPages(VDP& vdp);
void uploadVdpFrameBufferPixels(const u8* pixels, u32 width, u32 height);
void uploadVdpFrameBufferPixelRegion(const u8* pixels, i32 width, i32 height, i32 x, i32 y);
void readVdpFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y);
void readVdpDisplayFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y);
void restoreVdpFrameBufferContext(VDP& vdp, const u8* seedPixel);

} // namespace bmsx
