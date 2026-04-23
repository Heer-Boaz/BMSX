#pragma once

#include "core/primitives.h"
#include "render/backend/backend.h"
#include <string>

namespace bmsx {

bool vdpTextureUploadReady();
void loadVdpEngineAtlasViewTexture();
TextureHandle vdpTextureByUri(const std::string& textureKey);
TextureHandle ensureVdpTextureFromSeed(const std::string& textureKey, const u8* seedPixel, u32 width, u32 height);
TextureHandle resizeVdpTextureForKey(const std::string& textureKey, u32 width, u32 height);
TextureHandle updateVdpTexture(const std::string& textureKey, const u8* pixels, i32 width, i32 height);
void updateVdpTexturesForAsset(const std::string& textureKey, const u8* pixels, i32 width, i32 height);
void updateVdpTextureRegion(const std::string& textureKey, const u8* pixels, i32 width, i32 height, i32 x, i32 y);

} // namespace bmsx
