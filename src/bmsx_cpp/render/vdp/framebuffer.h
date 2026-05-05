#pragma once

#include "common/primitives.h"
#include "render/backend/backend.h"

namespace bmsx {

class VDP;

TextureHandle vdpDisplayFrameBufferTexture();
TextureHandle vdpRenderFrameBufferTexture();
void initializeVdpFrameBufferTextures(VDP& vdp);
void applyVdpFrameBufferTextureWrites(VDP& vdp);
void presentVdpFrameBufferPages();
void writeVdpRenderFrameBufferPixels(const u8* pixels, u32 width, u32 height);
void writeVdpDisplayFrameBufferPixels(const u8* pixels, u32 width, u32 height);
void writeVdpRenderFrameBufferPixelRegion(const u8* pixels, i32 width, i32 height, i32 x, i32 y);
void readVdpRenderFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y);
void readVdpDisplayFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y);

} // namespace bmsx
