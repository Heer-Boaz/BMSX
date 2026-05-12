#pragma once

#include "common/primitives.h"
#include "render/backend/backend.h"
#include "machine/devices/vdp/device_output.h"

namespace bmsx {

class GameView;
class TextureManager;
class VDP;

class VdpFrameBufferTextures final : public VdpSurfaceUploadSink, public VdpFrameBufferPresentationSink {
public:
	VdpFrameBufferTextures(TextureManager& textureManager, GameView& view);

	bool consumeVdpSurfaceUpload(const VdpSurfaceUpload& upload) override;
	void consumeVdpFrameBufferPresentation(const VdpFrameBufferPresentation& presentation) override;
	void initialize(VDP& vdp);
	TextureHandle displayTexture() const { return m_displayFrameBufferTexture; }
	TextureHandle renderTexture() const { return m_renderFrameBufferTexture; }
	u32 width() const { return m_frameBufferTextureWidth; }
	u32 height() const { return m_frameBufferTextureHeight; }

private:
	void presentVdpFrameBufferPages(u32 presentationCount);

	TextureManager& m_textureManager;
	GameView& m_view;
	TextureHandle m_renderFrameBufferTexture = nullptr;
	TextureHandle m_displayFrameBufferTexture = nullptr;
	u32 m_frameBufferTextureWidth = 0;
	u32 m_frameBufferTextureHeight = 0;
};

} // namespace bmsx
