#include "render/vdp/framebuffer.h"

#include "core/engine.h"
#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "render/vdp/blitter/gles2.h"
#include "render/vdp/surfaces.h"
#include "rompack/format.h"

namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};

} // namespace

bool hasVdpFrameBufferTexture() {
	return getVdpRenderFrameBufferTexture() != nullptr;
}

TextureHandle getVdpDisplayFrameBufferTexture() {
	return EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
}

TextureHandle getVdpRenderFrameBufferTexture() {
	return EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

static void ensureVdpDisplayFrameBufferTexture(const u8* seedPixel, u32 width, u32 height) {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	if (!handle) {
		const TextureKey key = texmanager->makeKey(FRAMEBUFFER_TEXTURE_KEY, DEFAULT_TEXTURE_PARAMS);
		handle = texmanager->getOrCreateTexture(key, seedPixel, 1, 1, DEFAULT_TEXTURE_PARAMS);
	}
	handle = texmanager->resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, static_cast<i32>(width), static_cast<i32>(height));
	EngineCore::instance().view()->textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

static void swapVdpFrameBufferTexturePages() {
	auto* texmanager = EngineCore::instance().texmanager();
	texmanager->swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	auto* view = EngineCore::instance().view();
	view->textures[FRAMEBUFFER_TEXTURE_KEY] = texmanager->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = texmanager->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::invalidateFrameBufferAttachment();
#endif
}

void syncVdpDisplayFrameBuffer(VDP& vdp, const u8* seedPixel) {
	ensureVdpDisplayFrameBufferTexture(seedPixel, vdp.frameBufferWidth(), vdp.frameBufferHeight());
	EngineCore::instance().texmanager()->copyTextureByUri(
		FRAMEBUFFER_RENDER_TEXTURE_KEY,
		FRAMEBUFFER_TEXTURE_KEY,
		static_cast<i32>(vdp.frameBufferWidth()),
		static_cast<i32>(vdp.frameBufferHeight())
	);
	vdp.syncDisplayFrameBufferReadback();
}

void presentVdpFrameBufferPages(VDP& vdp) {
	swapVdpFrameBufferTexturePages();
	vdp.swapFrameBufferReadbackPages();
}

void uploadVdpFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	auto* view = EngineCore::instance().view();
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = getVdpRenderFrameBufferTexture();
	if (!handle) {
		const TextureKey key = texmanager->makeKey(FRAMEBUFFER_RENDER_TEXTURE_KEY, DEFAULT_TEXTURE_PARAMS);
		handle = texmanager->getOrCreateTexture(key, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
		view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = handle;
		return;
	}
	handle = texmanager->resizeTextureForKey(FRAMEBUFFER_RENDER_TEXTURE_KEY, static_cast<i32>(width), static_cast<i32>(height));
	texmanager->updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	view->textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = handle;
}

void uploadVdpDisplayFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	auto* view = EngineCore::instance().view();
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = getVdpDisplayFrameBufferTexture();
	if (!handle) {
		const TextureKey key = texmanager->makeKey(FRAMEBUFFER_TEXTURE_KEY, DEFAULT_TEXTURE_PARAMS);
		handle = texmanager->getOrCreateTexture(key, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
		view->textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
		return;
	}
	handle = texmanager->resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, static_cast<i32>(width), static_cast<i32>(height));
	texmanager->updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	view->textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

void uploadVdpFrameBufferPixelRegion(const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	EngineCore::instance().texmanager()->updateTextureRegionForKey(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height, x, y);
}

void readVdpFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y) {
	EngineCore::instance().texmanager()->backend()->readTextureRegion(
		getVdpRenderFrameBufferTexture(),
		out,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

void readVdpDisplayFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y) {
	EngineCore::instance().texmanager()->backend()->readTextureRegion(
		getVdpDisplayFrameBufferTexture(),
		out,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

void restoreVdpFrameBufferContext(VDP& vdp, const u8* seedPixel) {
	for (const auto& slot : vdp.surfaceUploadSlots()) {
		if (!isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		uploadVdpFrameBufferPixels(slot.cpuReadback.data(), slot.surfaceWidth, slot.surfaceHeight);
		break;
	}
	syncVdpDisplayFrameBuffer(vdp, seedPixel);
}

} // namespace bmsx
