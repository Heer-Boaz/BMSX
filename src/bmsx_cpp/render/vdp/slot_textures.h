#pragma once

#include "common/types.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/device_output.h"
#include <array>
#include <string>

namespace bmsx {

class GameView;
class TextureManager;
class VDP;

struct VdpSlotTexturePixels {
	const u8* pixels = nullptr;
	u32 width = 0;
	u32 height = 0;
	u32 stride = 0;
};

struct VdpSlotTextureReadback {
	const u8* pixels = nullptr;
	u32 width = 0;
	u32 height = 0;
	u32 stride = 0;
};

class VdpSlotTextures final : public VdpSurfaceUploadSink {
public:
	VdpSlotTextures(TextureManager& textureManager, GameView& view);

	void initialize(VDP& vdp);
	bool consumeVdpSurfaceUpload(const VdpSurfaceUpload& upload) override;
	VdpSlotTexturePixels readSurfaceTexturePixels(u32 surfaceId) const;

private:
	bool isSyncedTextureSize(u32 surfaceId, u32 width, u32 height) const;
	void noteSyncedTextureSize(u32 surfaceId, u32 width, u32 height);
	void noteSlotTexturePixels(const VdpSurfaceUpload& upload);
	void uploadVdpSlotRows(const std::string& textureKey, const VdpSurfaceUpload& upload, u32 rowStart, u32 rowEnd);
	void uploadVdpSlotSpan(const std::string& textureKey, const VdpSurfaceUpload& upload, u32 row, u32 xStart, u32 xEnd);
	void initializeVdpSlotTexture(const VdpSurfaceUpload& upload);

	TextureManager& m_textureManager;
	GameView& m_view;
	std::array<u32, VDP_RD_SURFACE_COUNT> m_syncedTextureWidths{};
	std::array<u32, VDP_RD_SURFACE_COUNT> m_syncedTextureHeights{};
	std::array<VdpSlotTextureReadback, VDP_RD_SURFACE_COUNT> m_surfaceReadbacks{};
	bool m_initializing = false;
};

} // namespace bmsx
