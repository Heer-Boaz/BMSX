#include "render/vdp/texture_transfer.h"

#include "core/engine.h"
#include "render/gameview.h"
#include "render/texture_manager.h"

namespace bmsx {

bool vdpTextureUploadReady() {
	return EngineCore::instance().view()->backend()->readyForTextureUpload();
}

void loadVdpEngineAtlasViewTexture() {
	EngineCore::instance().view()->loadEngineAtlasTexture();
}

TextureHandle vdpTextureByUri(const std::string& textureKey) {
	return EngineCore::instance().texmanager()->getTextureByUri(textureKey);
}

TextureHandle ensureVdpTextureFromSeed(const std::string& textureKey, const u8* seedPixel, u32 width, u32 height) {
	TextureHandle handle = vdpTextureByUri(textureKey);
	auto* texmanager = EngineCore::instance().texmanager();
	if (!handle) {
		if (!texmanager->backend()->readyForTextureUpload()) {
			EngineCore::instance().view()->textures[textureKey] = nullptr;
			return nullptr;
		}
		TextureParams params;
		const TextureKey key = texmanager->makeKey(textureKey, params);
		handle = texmanager->getOrCreateTexture(key, seedPixel, 1, 1, params);
	}
	handle = texmanager->resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	EngineCore::instance().view()->textures[textureKey] = handle;
	return handle;
}

TextureHandle resizeVdpTextureForKey(const std::string& textureKey, u32 width, u32 height) {
	TextureHandle handle = EngineCore::instance().texmanager()->resizeTextureForKey(
		textureKey,
		static_cast<i32>(width),
		static_cast<i32>(height)
	);
	EngineCore::instance().view()->textures[textureKey] = handle;
	return handle;
}

TextureHandle updateVdpTexture(const std::string& textureKey, const u8* pixels, i32 width, i32 height) {
	TextureParams params;
	auto* texmanager = EngineCore::instance().texmanager();
	const TextureKey key = texmanager->makeKey(textureKey, params);
	TextureHandle handle = texmanager->getTexture(key);
	if (!handle) {
		handle = texmanager->getOrCreateTexture(key, pixels, width, height, params);
	} else {
		texmanager->updateTexture(handle, pixels, width, height, params);
	}
	EngineCore::instance().view()->textures[textureKey] = handle;
	return handle;
}

void updateVdpTexturesForAsset(const std::string& textureKey, const u8* pixels, i32 width, i32 height) {
	EngineCore::instance().texmanager()->updateTexturesForAsset(textureKey, pixels, width, height);
}

void updateVdpTextureRegion(const std::string& textureKey, const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	EngineCore::instance().texmanager()->updateTextureRegionForKey(textureKey, pixels, width, height, x, y);
}

} // namespace bmsx
