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

TextureHandle getVdpDisplayFrameBufferTexture() {
	return EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
}

TextureHandle getVdpRenderFrameBufferTexture() {
	return EngineCore::instance().texmanager()->getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
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

static TextureHandle createVdpFrameBufferTexture(const char* textureKey, const u8* pixels, u32 width, u32 height) {
	auto* texmanager = EngineCore::instance().texmanager();
	const TextureKey key = texmanager->makeKey(textureKey, DEFAULT_TEXTURE_PARAMS);
	TextureHandle handle = texmanager->getOrCreateTexture(key, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	handle = texmanager->resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	texmanager->updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	EngineCore::instance().view()->textures[textureKey] = handle;
	return handle;
}

static void uploadVdpFrameBufferTexturePixels(const char* textureKey, const u8* pixels, u32 width, u32 height) {
	auto* texmanager = EngineCore::instance().texmanager();
	TextureHandle handle = texmanager->resizeTextureForKey(textureKey, static_cast<i32>(width), static_cast<i32>(height));
	texmanager->updateTexture(handle, pixels, static_cast<i32>(width), static_cast<i32>(height), DEFAULT_TEXTURE_PARAMS);
	EngineCore::instance().view()->textures[textureKey] = handle;
}

void initializeVdpFrameBufferTextures(VDP& vdp) {
	vdp.setFrameBufferTextureRegionWriter(uploadVdpFrameBufferPixelRegion);
	createVdpFrameBufferTexture(FRAMEBUFFER_RENDER_TEXTURE_KEY, vdp.frameBufferRenderReadback().data(), vdp.frameBufferWidth(), vdp.frameBufferHeight());
	vdp.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
	createVdpFrameBufferTexture(FRAMEBUFFER_TEXTURE_KEY, vdp.frameBufferDisplayReadback().data(), vdp.frameBufferWidth(), vdp.frameBufferHeight());
}

void applyVdpFrameBufferTextureWrites(VDP& vdp) {
	for (const auto& slot : vdp.surfaceUploadSlots()) {
		if (!isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		if (slot.dirtyRowStart < slot.dirtyRowEnd) {
			const uint32_t rowBytes = slot.surfaceWidth * 4u;
			for (uint32_t row = slot.dirtyRowStart; row < slot.dirtyRowEnd; ++row) {
				const auto& span = slot.dirtySpansByRow[row];
				if (span.xStart >= span.xEnd) {
					continue;
				}
				const size_t byteOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes) + static_cast<size_t>(span.xStart) * 4u;
				uploadVdpFrameBufferPixelRegion(
					slot.cpuReadback.data() + byteOffset,
					static_cast<i32>(span.xEnd - span.xStart),
					1,
					static_cast<i32>(span.xStart),
					static_cast<i32>(row)
				);
			}
			vdp.clearSurfaceUploadDirty(slot.surfaceId);
		}
		break;
	}
}

void presentVdpFrameBufferPages(VDP& vdp) {
	applyVdpFrameBufferTextureWrites(vdp);
	swapVdpFrameBufferTexturePages();
	vdp.swapFrameBufferReadbackPages();
}

void uploadVdpFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	uploadVdpFrameBufferTexturePixels(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height);
}

void uploadVdpDisplayFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	uploadVdpFrameBufferTexturePixels(FRAMEBUFFER_TEXTURE_KEY, pixels, width, height);
}

void uploadVdpFrameBufferPixelRegion(const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	EngineCore::instance().texmanager()->backend()->updateTextureRegion(
		getVdpRenderFrameBufferTexture(),
		pixels,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
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

void syncVdpRenderFrameBufferReadback(VDP& vdp) {
	readVdpFrameBufferPixels(
		vdp.frameBufferRenderReadback().data(),
		static_cast<i32>(vdp.frameBufferWidth()),
		static_cast<i32>(vdp.frameBufferHeight()),
		0,
		0
	);
	vdp.invalidateFrameBufferReadCache();
}

void restoreVdpFrameBufferContext(VDP& vdp) {
	initializeVdpFrameBufferTextures(vdp);
}

} // namespace bmsx
