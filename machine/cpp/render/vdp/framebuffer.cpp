#include "render/vdp/framebuffer.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "rompack/format.h"
#include <array>

namespace bmsx {
namespace {

const std::array<u8, 4> EMPTY_TEXTURE_SEED{{0, 0, 0, 0}};
} // namespace

VdpFrameBufferTextures::VdpFrameBufferTextures(TextureManager& textureManager, GameView& view)
	: m_textureManager(textureManager)
	, m_view(view) {
}


void VdpFrameBufferTextures::initialize(VDP& vdp) {
	m_frameBufferTextureWidth = vdp.frameBufferWidth();
	m_frameBufferTextureHeight = vdp.frameBufferHeight();
	m_renderFrameBufferTexture = m_textureManager.createTextureFromPixelsSync(
		FRAMEBUFFER_RENDER_TEXTURE_KEY,
		EMPTY_TEXTURE_SEED.data(),
		1,
		1,
		RGBA8_LINEAR_TEXTURE_PARAMS
	);
	m_renderFrameBufferTexture = m_textureManager.resizeTextureForKey(
		FRAMEBUFFER_RENDER_TEXTURE_KEY,
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight),
		RGBA8_LINEAR_TEXTURE_PARAMS
	);
	m_view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = m_renderFrameBufferTexture;
	m_displayFrameBufferTexture = m_textureManager.createTextureFromPixelsSync(
		FRAMEBUFFER_TEXTURE_KEY,
		EMPTY_TEXTURE_SEED.data(),
		1,
		1,
		RGBA8_LINEAR_TEXTURE_PARAMS
	);
	m_displayFrameBufferTexture = m_textureManager.resizeTextureForKey(
		FRAMEBUFFER_TEXTURE_KEY,
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight),
		RGBA8_LINEAR_TEXTURE_PARAMS
	);
	m_view.textures[FRAMEBUFFER_TEXTURE_KEY] = m_displayFrameBufferTexture;
	m_view.backend()->updateTextureRegion(
		m_textureManager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, RGBA8_LINEAR_TEXTURE_PARAMS),
		vdp.frameBufferRenderReadback().data(),
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight),
		0,
		0,
		RGBA8_LINEAR_TEXTURE_PARAMS
	);
	m_view.backend()->updateTextureRegion(
		m_textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY, RGBA8_LINEAR_TEXTURE_PARAMS),
		vdp.frameBufferDisplayReadback().data(),
		static_cast<i32>(m_frameBufferTextureWidth),
		static_cast<i32>(m_frameBufferTextureHeight),
		0,
		0,
		RGBA8_LINEAR_TEXTURE_PARAMS
	);
}

} // namespace bmsx
