#include "render/vdp/texture_transfer.h"

#include "render/gameview.h"
#include "render/texture_manager.h"

namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};
TextureManager* g_vdpTextureManager = nullptr;
GameView* g_vdpTextureView = nullptr;

TextureManager& vdpTextureManager() {
	return *g_vdpTextureManager;
}

GameView& vdpTextureView() {
	return *g_vdpTextureView;
}

} // namespace

void initializeVdpTextureTransfer(TextureManager& textureManager, GameView& view) {
	g_vdpTextureManager = &textureManager;
	g_vdpTextureView = &view;
}

GPUBackend& vdpTextureBackend() {
	return *vdpTextureManager().backend();
}

TextureHandle vdpTextureByUri(const std::string& textureKey) {
	return vdpTextureManager().getTextureByUri(textureKey);
}

TextureHandle createVdpTextureFromSeed(const std::string& textureKey, const u8* seedPixel, u32 width, u32 height) {
	auto& texmanager = vdpTextureManager();
	const TextureKey key = texmanager.makeKey(textureKey, DEFAULT_TEXTURE_PARAMS);
	texmanager.getOrCreateTexture(key, seedPixel, 1, 1, DEFAULT_TEXTURE_PARAMS);
	TextureHandle handle = vdpTextureByUri(textureKey);
	handle = texmanager.resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	vdpTextureView().textures[textureKey] = handle;
	return handle;
}

TextureHandle createVdpTextureFromPixels(const std::string& textureKey, const u8* pixels, u32 width, u32 height) {
	auto& texmanager = vdpTextureManager();
	const TextureKey key = texmanager.makeKey(textureKey, DEFAULT_TEXTURE_PARAMS);
	TextureHandle handle = texmanager.getOrCreateTexture(key, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	handle = texmanager.resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	texmanager.updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	vdpTextureView().textures[textureKey] = handle;
	return handle;
}

TextureHandle resizeVdpTextureForKey(const std::string& textureKey, u32 width, u32 height) {
	TextureHandle handle = vdpTextureManager().resizeTextureForKey(
		textureKey,
		static_cast<i32>(width),
		static_cast<i32>(height)
	);
	vdpTextureView().textures[textureKey] = handle;
	return handle;
}

TextureHandle updateVdpTexturePixels(const std::string& textureKey, const u8* pixels, u32 width, u32 height) {
	TextureHandle handle = resizeVdpTextureForKey(textureKey, width, height);
	vdpTextureManager().updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	return handle;
}

// disable-next-line single_line_method_pattern -- VDP slot uploads use texture keys while texture memory keeps manager/backend access private.
void updateVdpTextureRegion(const std::string& textureKey, const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	vdpTextureBackend().updateTextureRegion(
		vdpTextureByUri(textureKey),
		pixels,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

void swapVdpTextureHandlesByUri(const std::string& textureKeyA, const std::string& textureKeyB) {
	vdpTextureManager().swapTextureHandlesByUri(textureKeyA, textureKeyB);
	vdpTextureView().textures[textureKeyA] = vdpTextureByUri(textureKeyA);
	vdpTextureView().textures[textureKeyB] = vdpTextureByUri(textureKeyB);
}

} // namespace bmsx
