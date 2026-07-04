#pragma once

#include "common/primitives.h"
#include "render/backend/backend.h"

namespace bmsx {

class GameView;
class TextureManager;
class VDP;

class VdpFrameBufferTextures final {
public:
	VdpFrameBufferTextures(TextureManager& textureManager, GameView& view);

	void initialize(VDP& vdp);
	TextureHandle displayTexture() const { return m_displayFrameBufferTexture; }
	TextureHandle renderTexture() const { return m_renderFrameBufferTexture; }
	u32 width() const { return m_frameBufferTextureWidth; }
	u32 height() const { return m_frameBufferTextureHeight; }

private:
	TextureManager& m_textureManager;
	GameView& m_view;
	TextureHandle m_renderFrameBufferTexture = nullptr;
	TextureHandle m_displayFrameBufferTexture = nullptr;
	u32 m_frameBufferTextureWidth = 0;
	u32 m_frameBufferTextureHeight = 0;
};

} // namespace bmsx
