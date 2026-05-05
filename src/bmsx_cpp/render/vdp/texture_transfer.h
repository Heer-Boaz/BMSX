#pragma once

#include "common/primitives.h"
#include "render/backend/backend.h"
#include <string>

namespace bmsx {

class GameView;
class TextureManager;

void initializeVdpTextureTransfer(TextureManager& textureManager, GameView& view);
GPUBackend& vdpTextureBackend();
TextureHandle vdpTextureByUri(const std::string& textureKey);
TextureHandle createVdpTextureFromSeed(const std::string& textureKey, const u8* seedPixel, u32 width, u32 height);
TextureHandle createVdpTextureFromPixels(const std::string& textureKey, const u8* pixels, u32 width, u32 height);
TextureHandle resizeVdpTextureForKey(const std::string& textureKey, u32 width, u32 height);
TextureHandle updateVdpTexturePixels(const std::string& textureKey, const u8* pixels, u32 width, u32 height);
void updateVdpTextureRegion(const std::string& textureKey, const u8* pixels, i32 width, i32 height, i32 x, i32 y);
void swapVdpTextureHandlesByUri(const std::string& textureKeyA, const std::string& textureKeyB);

} // namespace bmsx
