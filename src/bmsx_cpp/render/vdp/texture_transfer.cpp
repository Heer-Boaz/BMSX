#include "render/vdp/texture_transfer.h"

#include "render/gameview.h"
#include "render/texture_manager.h"

namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};
TextureManager* g_vdpTextureManager = nullptr;
GameView* g_vdpTextureView = nullptr;

} // namespace

void initializeVdpTextureTransfer(TextureManager& textureManager, GameView& view) {
	g_vdpTextureManager = &textureManager;
	g_vdpTextureView = &view;
}

GPUBackend& vdpTextureBackend() {
	return *g_vdpTextureView->backend();
}

TextureHandle vdpTextureByUri(const std::string& textureKey) {
	return g_vdpTextureManager->getTextureByUri(textureKey);
}

TextureHandle createVdpTextureFromSeed(const std::string& textureKey, const u8* seedPixel, u32 width, u32 height) {
	auto& texmanager = *g_vdpTextureManager;
	texmanager.createTextureFromPixelsSync(textureKey, seedPixel, 1, 1, DEFAULT_TEXTURE_PARAMS);
	TextureHandle handle = vdpTextureByUri(textureKey);
	handle = texmanager.resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	g_vdpTextureView->textures[textureKey] = handle;
	return handle;
}

TextureHandle createVdpTextureFromPixels(const std::string& textureKey, const u8* pixels, u32 width, u32 height) {
	auto& texmanager = *g_vdpTextureManager;
	TextureHandle handle = texmanager.createTextureFromPixelsSync(textureKey, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	handle = texmanager.resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	vdpTextureBackend().updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	g_vdpTextureView->textures[textureKey] = handle;
	return handle;
}

TextureHandle resizeVdpTextureForKey(const std::string& textureKey, u32 width, u32 height) {
	TextureHandle handle = g_vdpTextureManager->resizeTextureForKey(
		textureKey,
		static_cast<i32>(width),
		static_cast<i32>(height)
	);
	g_vdpTextureView->textures[textureKey] = handle;
	return handle;
}

TextureHandle updateVdpTexturePixels(const std::string& textureKey, const u8* pixels, u32 width, u32 height) {
	TextureHandle handle = resizeVdpTextureForKey(textureKey, width, height);
	vdpTextureBackend().updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	return handle;
}

void updateVdpTextureRegion(const std::string& textureKey, const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	vdpTextureBackend().updateTextureRegion(vdpTextureByUri(textureKey), pixels, width, height, x, y, DEFAULT_TEXTURE_PARAMS);
}

void swapVdpTextureHandlesByUri(const std::string& textureKeyA, const std::string& textureKeyB) {
	g_vdpTextureManager->swapTextureHandlesByUri(textureKeyA, textureKeyB);
	g_vdpTextureView->textures[textureKeyA] = vdpTextureByUri(textureKeyA);
	g_vdpTextureView->textures[textureKeyB] = vdpTextureByUri(textureKeyB);
}

} // namespace bmsx
