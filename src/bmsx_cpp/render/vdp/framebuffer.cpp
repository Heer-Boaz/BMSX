#include "render/vdp/framebuffer.h"

#include "core/engine.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "render/vdp/blitter/gles2.h"
#include "rompack/format.h"

namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};

} // namespace

bool vdpRenderFrameBufferTextureExists() {
	return EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY) != nullptr;
}

void ensureVdpDisplayFrameBufferTexture(const u8* seedPixel, u32 width, u32 height) {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	if (!handle) {
		const TextureKey key = texmanager->makeKey(FRAMEBUFFER_TEXTURE_KEY, DEFAULT_TEXTURE_PARAMS);
		handle = texmanager->getOrCreateTexture(key, seedPixel, 1, 1, DEFAULT_TEXTURE_PARAMS);
	}
	handle = texmanager->resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, static_cast<i32>(width), static_cast<i32>(height));
	EngineCore::instance().view()->textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

void swapVdpFrameBufferTexturePages() {
	auto* texmanager = EngineCore::instance().texmanager();
	texmanager->swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	auto* view = EngineCore::instance().view();
	view->textures[FRAMEBUFFER_TEXTURE_KEY] = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = texmanager->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::invalidateFrameBufferAttachment();
#endif
}

void copyVdpRenderFrameBufferToDisplay(u32 width, u32 height) {
	EngineCore::instance().texmanager()->copyTextureByUri(
		FRAMEBUFFER_RENDER_TEXTURE_KEY,
		FRAMEBUFFER_TEXTURE_KEY,
		static_cast<i32>(width),
		static_cast<i32>(height)
	);
}

void updateVdpRenderFrameBufferTexture(const u8* pixels, u32 width, u32 height) {
	auto* view = EngineCore::instance().view();
	TextureHandle handle = view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY];
	EngineCore::instance().texmanager()->updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
}

void readVdpRenderFrameBufferTextureRegion(u8* out, i32 width, i32 height, i32 x, i32 y) {
	auto* texmanager = EngineCore::instance().texmanager();
	texmanager->backend()->readTextureRegion(
		texmanager->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY),
		out,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

} // namespace bmsx
