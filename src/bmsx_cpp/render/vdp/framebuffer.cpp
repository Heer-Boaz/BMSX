#include "render/vdp/framebuffer.h"

#include "machine/devices/vdp/vdp.h"
#include "render/vdp/blitter/gles2.h"
#include "render/vdp/surfaces.h"
#include "render/vdp/texture_transfer.h"
#include "rompack/format.h"
#include <utility>

namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};
TextureHandle renderFrameBufferTexture = nullptr;
TextureHandle displayFrameBufferTexture = nullptr;

} // namespace

TextureHandle vdpDisplayFrameBufferTexture() {
	return displayFrameBufferTexture;
}

TextureHandle vdpRenderFrameBufferTexture() {
	return renderFrameBufferTexture;
}

static void swapVdpFrameBufferTexturePages() {
	swapVdpTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	std::swap(renderFrameBufferTexture, displayFrameBufferTexture);
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::invalidateFrameBufferAttachment();
#endif
}

void writeVdpRenderFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	renderFrameBufferTexture = updateVdpTexturePixels(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height);
}

void writeVdpDisplayFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	displayFrameBufferTexture = updateVdpTexturePixels(FRAMEBUFFER_TEXTURE_KEY, pixels, width, height);
}

// disable-next-line single_line_method_pattern -- framebuffer VRAM writes hit the owned render texture directly on the hot path.
void writeVdpRenderFrameBufferPixelRegion(const u8* pixels, i32 width, i32 height, i32 x, i32 y) {
	vdpTextureBackend().updateTextureRegion(
		renderFrameBufferTexture,
		pixels,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

// disable-next-line single_line_method_pattern -- framebuffer readback is the concrete VDP texture boundary for save-state and MMIO reads.
void readVdpRenderFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y) {
	vdpTextureBackend().readTextureRegion(
		renderFrameBufferTexture,
		out,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

// disable-next-line single_line_method_pattern -- display-page readback is the concrete VDP texture boundary for headless presentation and save-state.
void readVdpDisplayFrameBufferPixels(u8* out, i32 width, i32 height, i32 x, i32 y) {
	vdpTextureBackend().readTextureRegion(
		displayFrameBufferTexture,
		out,
		width,
		height,
		x,
		y,
		DEFAULT_TEXTURE_PARAMS
	);
}

void syncVdpRenderFrameBufferReadback(VDP& vdp) {
	readVdpRenderFrameBufferPixels(
		vdp.frameBufferRenderReadback().data(),
		static_cast<i32>(vdp.frameBufferWidth()),
		static_cast<i32>(vdp.frameBufferHeight()),
		0,
		0
	);
	vdp.invalidateFrameBufferReadCache();
}

void initializeVdpFrameBufferTextures(VDP& vdp) {
	renderFrameBufferTexture = createVdpTextureFromPixels(FRAMEBUFFER_RENDER_TEXTURE_KEY, vdp.frameBufferRenderReadback().data(), vdp.frameBufferWidth(), vdp.frameBufferHeight());
	vdp.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
	displayFrameBufferTexture = createVdpTextureFromPixels(FRAMEBUFFER_TEXTURE_KEY, vdp.frameBufferDisplayReadback().data(), vdp.frameBufferWidth(), vdp.frameBufferHeight());
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
				writeVdpRenderFrameBufferPixelRegion(
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

} // namespace bmsx
