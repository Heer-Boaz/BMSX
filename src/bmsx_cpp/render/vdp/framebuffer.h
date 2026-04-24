#pragma once

#include "core/primitives.h"
#include "render/backend/backend.h"

namespace bmsx {

class VDP;

TextureHandle getVdpDisplayFrameBufferTexture();
TextureHandle getVdpRenderFrameBufferTexture();
void initializeVdpFrameBufferTextures(VDP& vdp);
void applyVdpFrameBufferTextureWrites(VDP& vdp);
void presentVdpFrameBufferPages(VDP& vdp);
void uploadVdpFrameBufferPixels(const u8* pixels, u32 width, u32 height);
void uploadVdpDisplayFrameBufferPixels(const u8* pixels, u32 width, u32 height);
void uploadVdpFrameBufferPixelRegion(const u8* pixels, i32 width, i32 height, i32 x, i32 y);
void readVdpFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y);
void readVdpDisplayFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y);
void syncVdpRenderFrameBufferReadback(VDP& vdp);
void restoreVdpFrameBufferContext(VDP& vdp);

} // namespace bmsx
