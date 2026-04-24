#include "render/vdp/texture_transfer.h"

#include "core/engine.h"
#include "render/gameview.h"
#include "render/texture_manager.h"

namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};

} // namespace

TextureHandle vdpTextureByUri(const std::string& textureKey) {
	return EngineCore::instance().texmanager()->getTextureByUri(textureKey);
}

TextureHandle createVdpTextureFromSeed(const std::string& textureKey, const u8* seedPixel, u32 width, u32 height) {
	auto* texmanager = EngineCore::instance().texmanager();
	const TextureKey key = texmanager->makeKey(textureKey, DEFAULT_TEXTURE_PARAMS);
	texmanager->getOrCreateTexture(key, seedPixel, 1, 1, DEFAULT_TEXTURE_PARAMS);
	TextureHandle handle = vdpTextureByUri(textureKey);
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

void updateVdpTextureRegion(const std::string& textureKey, const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	EngineCore::instance().texmanager()->backend()->updateTextureRegion(
		vdpTextureByUri(textureKey),
		pixels,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

} // namespace bmsx
