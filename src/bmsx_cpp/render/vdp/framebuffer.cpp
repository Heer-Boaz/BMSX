#include "render/vdp/framebuffer.h"

#include "core/engine.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "render/vdp/blitter/gles2.h"
#include "rompack/format.h"

namespace bmsx {

VdpFrameBufferSize currentVdpFrameBufferSize() {
	auto* view = EngineCore::instance().view();
	return {
		static_cast<u32>(view->viewportSize.x),
		static_cast<u32>(view->viewportSize.y),
	};
}

bool vdpRenderFrameBufferTextureExists() {
	return EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY) != nullptr;
}

void ensureVdpDisplayFrameBufferTexture(const u8* seedPixel, u32 width, u32 height) {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	if (!handle) {
		TextureParams params;
		const TextureKey key = texmanager->makeKey(FRAMEBUFFER_TEXTURE_KEY, params);
		handle = texmanager->getOrCreateTexture(key, seedPixel, 1, 1, params);
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
	TextureParams params;
	auto* view = EngineCore::instance().view();
	TextureHandle handle = view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY];
	EngineCore::instance().texmanager()->updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), params);
}

} // namespace bmsx
