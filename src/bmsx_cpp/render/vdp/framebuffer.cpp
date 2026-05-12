#include "render/vdp/framebuffer.h"

#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "rompack/format.h"
#include <utility>
#include <vector>

namespace bmsx {

VdpFrameBufferTextures::VdpFrameBufferTextures(TextureManager& textureManager, GameView& view)
	: m_textureManager(textureManager)
	, m_view(view) {
}

bool VdpFrameBufferTextures::consumeVdpSurfaceUpload(const VdpSurfaceUpload& upload) {
	if (upload.surfaceId != VDP_RD_SURFACE_FRAMEBUFFER) {
		return false;
	}
	m_frameBufferTextureWidth = upload.surfaceWidth;
	m_frameBufferTextureHeight = upload.surfaceHeight;
	return true;
}

void VdpFrameBufferTextures::consumeVdpFrameBufferPresentation(const VdpFrameBufferPresentation& presentation) {
	presentVdpFrameBufferPages(presentation.presentationCount);
	const u32 width = presentation.width;
	const u32 height = presentation.height;
	m_frameBufferTextureWidth = width;
	m_frameBufferTextureHeight = height;
	if (presentation.presentationCount != 1u || presentation.requiresFullSync) {
		m_view.backend()->updateTextureRegion(
			m_textureManager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY),
			presentation.renderReadback->data(),
			static_cast<i32>(width),
			static_cast<i32>(height),
			0,
			0,
			DEFAULT_TEXTURE_PARAMS
		);
		m_view.backend()->updateTextureRegion(
			m_textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY),
			presentation.displayReadback->data(),
			static_cast<i32>(width),
			static_cast<i32>(height),
			0,
			0,
			DEFAULT_TEXTURE_PARAMS
		);
		return;
	}
	const u32 rowBytes = width * 4u;
	const auto& pixels = *presentation.displayReadback;
	const auto& spans = *presentation.dirtySpansByRow;
	for (u32 row = presentation.dirtyRowStart; row < presentation.dirtyRowEnd; ++row) {
		const auto& span = spans[row];
		if (span.xStart >= span.xEnd) {
			continue;
		}
		const size_t byteOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes) + static_cast<size_t>(span.xStart) * 4u;
		m_view.backend()->updateTextureRegion(
			m_textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY),
			pixels.data() + byteOffset,
			static_cast<i32>(span.xEnd - span.xStart),
			1,
			static_cast<i32>(span.xStart),
			static_cast<i32>(row),
			DEFAULT_TEXTURE_PARAMS
		);
	}
}

void VdpFrameBufferTextures::initialize(VDP& vdp) {
	const std::vector<u8>* renderReadback = vdp.frameBufferRenderReadback();
	if (renderReadback == nullptr) {
		return;
	}
	m_frameBufferTextureWidth = vdp.frameBufferWidth();
	m_frameBufferTextureHeight = vdp.frameBufferHeight();
	m_renderFrameBufferTexture = m_textureManager.createTextureFromPixelsSync(
		FRAMEBUFFER_RENDER_TEXTURE_KEY,
		renderReadback->data(),
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight)
	);
	m_renderFrameBufferTexture = m_textureManager.resizeTextureForKey(
		FRAMEBUFFER_RENDER_TEXTURE_KEY,
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight)
	);
	m_view.backend()->updateTexture(
		m_renderFrameBufferTexture,
		renderReadback->data(),
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight),
		DEFAULT_TEXTURE_PARAMS
	);
	m_view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = m_renderFrameBufferTexture;
	vdp.drainSurfaceUploads(*this);
	m_displayFrameBufferTexture = m_textureManager.createTextureFromPixelsSync(
		FRAMEBUFFER_TEXTURE_KEY,
		vdp.frameBufferDisplayReadback().data(),
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight)
	);
	m_displayFrameBufferTexture = m_textureManager.resizeTextureForKey(
		FRAMEBUFFER_TEXTURE_KEY,
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight)
	);
	m_view.backend()->updateTexture(
		m_displayFrameBufferTexture,
		vdp.frameBufferDisplayReadback().data(),
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight),
		DEFAULT_TEXTURE_PARAMS
	);
	m_view.textures[FRAMEBUFFER_TEXTURE_KEY] = m_displayFrameBufferTexture;
	vdp.clearFrameBufferPresentation();
}

void VdpFrameBufferTextures::presentVdpFrameBufferPages(u32 presentationCount) {
	for (u32 index = 0; index < presentationCount; ++index) {
		m_textureManager.swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
		m_view.textures[FRAMEBUFFER_TEXTURE_KEY] = m_textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
		m_view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = m_textureManager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
		std::swap(m_renderFrameBufferTexture, m_displayFrameBufferTexture);
	}
}

} // namespace bmsx
