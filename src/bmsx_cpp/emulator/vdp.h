#pragma once

#include "cpu.h"
#include "io.h"
#include "memory.h"
#include "vdp_render_budget.h"
#include "../rompack/rompack.h"
#include "../render/shared/render_types.h"
#include <array>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

class RuntimeAssets;
class GameView;
struct ImgAsset;
class ImgDecController;
class BFont;
struct VdpGles2Blitter;

class VDP : public Memory::VramWriter, public Memory::VdpIoHandler {
public:
	explicit VDP(Memory& memory);

	void initializeRegisters();
	void syncRegisters();
	void setDitherType(i32 type);
	i32 getDitherType() const { return m_lastDitherType; }
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void readVram(uint32_t addr, u8* out, size_t length) const override;
	void beginFrame();
	bool canAcceptSubmittedFrame() const { return !m_pendingFrameOccupied; }
	void beginSubmittedFrame();
	void cancelSubmittedFrame();
	void sealSubmittedFrame();
	void advanceWork(int workUnits);
	void presentReadyFrameOnVblankEdge();
	void enqueueClear(const Color& color);
	void enqueueBlit(u32 handle, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color, f32 parallaxWeight = 0.0f);
	void enqueueCopyRect(i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, f32 z, Layer2D layer);
	void enqueueFillRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color);
		void enqueueDrawLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness);
		void enqueueDrawRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color);
		void enqueueDrawPoly(const std::vector<f32>& points, f32 z, const Color& color, f32 thickness, Layer2D layer);
		void enqueueGlyphRun(const std::string& text, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer);
		void enqueueGlyphRun(const std::vector<std::string>& lines, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer);
		void enqueueTileRun(const std::vector<u32>& handles, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
		void enqueuePayloadTileRun(uint32_t payloadBase, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
		void enqueuePayloadTileRunWords(const u32* payloadWords, uint32_t tileCount, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	uint32_t frameBufferWidth() const { return m_frameBufferWidth; }
	uint32_t frameBufferHeight() const { return m_frameBufferHeight; }
	uint32_t readVdpStatus() override;
	uint32_t readVdpData() override;

	void registerImageAssets(RuntimeAssets& assets, bool keepDecodedData);
	void restoreVramSlotTextures();
	void captureVramTextureSnapshots();
	void shutdownBackendResources();
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	void attachImgDecController(ImgDecController& controller);
	void setSkyboxImages(const SkyboxImageIds& ids);
	void clearSkybox();
	std::optional<SkyboxImageIds> skyboxFaceIds() const;
	void commitLiveVisualState();
	void commitViewSnapshot(GameView& view);
	uint32_t trackedUsedVramBytes() const;
	uint32_t trackedTotalVramBytes() const;
	bool lastFrameCommitted() const { return m_lastFrameCommitted; }
	int lastFrameCost() const { return m_lastFrameCost; }
	bool lastFrameHeld() const { return m_lastFrameHeld; }

	const std::array<i32, 2>& atlasSlots() const { return m_slotAtlasIds; }

private:
	struct ReadSurface {
		std::string assetId;
		std::string textureKey;
	};
	struct ReadCache {
		uint32_t x0 = 0;
		uint32_t y = 0;
		uint32_t width = 0;
		std::vector<u8> data;
	};
	enum class VramSlotKind {
		Asset,
		Skybox,
	};
	struct VramSlot {
		VramSlotKind kind = VramSlotKind::Asset;
		uint32_t baseAddr = 0;
		uint32_t capacity = 0;
		std::string assetId;
		std::string textureKey;
		uint32_t surfaceId = 0;
		uint32_t textureWidth = 0;
		uint32_t textureHeight = 0;
		std::vector<u8> cpuReadback;
		std::vector<u8> contextSnapshot;
	};
	struct VramGarbageStream {
		uint32_t machineSeed = 0;
		uint32_t bootSeed = 0;
		uint32_t slotSalt = 0;
		uint32_t addr = 0;
	};
	struct FrameBufferColor {
		u8 r = 255;
		u8 g = 255;
		u8 b = 255;
		u8 a = 255;
	};
	struct BlitterSource {
		u32 surfaceId = 0;
		u32 srcX = 0;
		u32 srcY = 0;
		u32 width = 0;
		u32 height = 0;
	};
	struct GlyphRunGlyph : BlitterSource {
		f32 dstX = 0.0f;
		f32 dstY = 0.0f;
		u32 advance = 0;
	};
	struct TileRunBlit : BlitterSource {
		f32 dstX = 0.0f;
		f32 dstY = 0.0f;
	};
	enum class BlitterCommandType : u8 {
		Clear,
		Blit,
		CopyRect,
		FillRect,
		DrawLine,
		GlyphRun,
		TileRun,
	};
	struct BlitterCommand {
		BlitterCommandType type = BlitterCommandType::Clear;
		u32 seq = 0;
		int renderCost = 0;
		f32 z = 0.0f;
		Layer2D layer = Layer2D::World;
		BlitterSource source{};
		f32 dstX = 0.0f;
		f32 dstY = 0.0f;
		f32 scaleX = 1.0f;
		f32 scaleY = 1.0f;
		f32 parallaxWeight = 0.0f;
		bool flipH = false;
		bool flipV = false;
		i32 srcX = 0;
		i32 srcY = 0;
		i32 width = 0;
		i32 height = 0;
		f32 x0 = 0.0f;
		f32 y0 = 0.0f;
		f32 x1 = 0.0f;
		f32 y1 = 0.0f;
		f32 thickness = 1.0f;
		FrameBufferColor color{};
		std::optional<FrameBufferColor> backgroundColor;
		u32 lineHeight = 0;
		std::vector<GlyphRunGlyph> glyphs;
		std::vector<TileRunBlit> tiles;
	};
	Memory& m_memory;
	ImgDecController* m_imgDecController = nullptr;
	std::unordered_map<i32, std::string> m_atlasResourceById;
	std::unordered_map<i32, std::vector<std::string>> m_atlasViewIdsById;
	std::unordered_map<i32, i32> m_atlasSlotById;
	std::array<i32, 2> m_slotAtlasIds{{-1, -1}};
	std::vector<VramSlot> m_vramSlots;
	std::vector<u8> m_vramStaging;
	std::vector<u8> m_vramGarbageScratch;
	std::array<u8, 4> m_vramSeedPixel{{0, 0, 0, 0}};
	uint32_t m_vramMachineSeed = 0;
	uint32_t m_vramBootSeed = 0;
	uint32_t m_readBudgetBytes = 0;
	bool m_readOverflow = false;
	SkyboxImageIds m_skyboxFaceIds;
	bool m_hasSkybox = false;
	SkyboxImageIds m_committedSkyboxFaceIds;
	bool m_committedHasSkybox = false;
	i32 m_lastDitherType = 0;
	i32 m_committedDitherType = 0;
	std::vector<BlitterCommand> m_buildBlitterQueue;
	std::vector<BlitterCommand> m_activeBlitterQueue;
	std::vector<BlitterCommand> m_pendingBlitterQueue;
	std::vector<std::vector<GlyphRunGlyph>> m_glyphBufferPool;
	std::vector<std::vector<TileRunBlit>> m_tileBufferPool;
	u32 m_blitterSequence = 0;
	int m_buildFrameCost = 0;
	bool m_buildFrameOpen = false;
	bool m_activeFrameOccupied = false;
	bool m_activeFrameReady = false;
	int m_activeFrameCost = 0;
	int m_activeFrameWorkRemaining = 0;
	bool m_pendingFrameOccupied = false;
	int m_pendingFrameCost = 0;
	std::array<i32, 2> m_activeSlotAtlasIds{{-1, -1}};
	std::array<i32, 2> m_pendingSlotAtlasIds{{-1, -1}};
	i32 m_activeDitherType = 0;
	i32 m_pendingDitherType = 0;
	SkyboxImageIds m_activeSkyboxFaceIds;
	bool m_activeHasSkybox = false;
	SkyboxImageIds m_pendingSkyboxFaceIds;
	bool m_pendingHasSkybox = false;
	std::array<i32, 2> m_committedSlotAtlasIds{{-1, -1}};
	bool m_lastFrameCommitted = true;
	int m_lastFrameCost = 0;
	bool m_lastFrameHeld = false;
	uint32_t m_frameBufferWidth = 0;
	uint32_t m_frameBufferHeight = 0;
	std::vector<u8> m_frameBufferPriorityLayer;
	std::vector<f32> m_frameBufferPriorityZ;
	std::vector<u32> m_frameBufferPrioritySeq;
	std::vector<u8> m_displayFrameBufferCpuReadback;
	std::array<Memory::ImageWriteEntry, 6> m_skyboxSlots{};
	std::array<ReadSurface, 4> m_readSurfaces{};
	std::array<ReadCache, 4> m_readCaches{};

	void registerVramSlot(const Memory::AssetEntry& entry, const std::string& textureKey, uint32_t surfaceId);
	void registerReadSurface(uint32_t surfaceId, const std::string& assetId, const std::string& textureKey);
	const ReadSurface& getReadSurface(uint32_t surfaceId) const;
	void invalidateReadCache(uint32_t surfaceId);
	ReadCache& getReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y);
	void prefetchReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y);
	std::vector<u8> readSurfacePixels(const ReadSurface& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height);
	VramSlot& findVramSlot(uint32_t addr, size_t length);
	const VramSlot& findVramSlot(uint32_t addr, size_t length) const;
	void syncVramSlotTextureSize(VramSlot& slot);
	VramSlot& getVramSlotByTextureKey(const std::string& textureKey);
	const VramSlot& getVramSlotByTextureKey(const std::string& textureKey) const;
		uint32_t nextVramMachineSeed() const;
	uint32_t nextVramBootSeed() const;
	void fillVramGarbageScratch(u8* data, size_t length, VramGarbageStream& stream) const;
	void seedVramStaging();
	void seedVramSlotTexture(VramSlot& slot);
	void setSlotTextureSize(const std::string& textureKey, uint32_t width, uint32_t height);
	void restoreVramSlotTexture(const Memory::AssetEntry& entry, const std::string& textureKey);
	FrameBufferColor packFrameBufferColor(const Color& color) const;
	u32 nextBlitterSequence();
	std::vector<GlyphRunGlyph> acquireGlyphBuffer();
	std::vector<TileRunBlit> acquireTileBuffer();
	void recycleBlitterBuffers(std::vector<BlitterCommand>& queue);
	void resetBuildFrameState();
	void enqueueBlitterCommand(BlitterCommand&& command);
	int calculateVisibleRectCost(double width, double height) const;
	int calculateAlphaMultiplier(const FrameBufferColor& color) const;
	void executeBlitterQueue(const std::vector<BlitterCommand>& queue);
	void commitSkyboxImages(const SkyboxImageIds& ids);
	void ensureDisplayFrameBufferTexture();
	void swapFrameBufferPages();
	void syncRenderFrameBufferToDisplayPage();
	void assignBuildToSlot(bool active);
	void promotePendingFrame();
	void clearActiveFrame();
	void commitActiveVisualState();
	void initializeFrameBufferSurface();
	void resetFrameBufferPriority();
	BlitterSource resolveBlitterSource(u32 handle) const;
	void blendFrameBufferPixel(std::vector<u8>& pixels, size_t index, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 z, u32 seq);
	void rasterizeFrameBufferFill(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, const FrameBufferColor& color, Layer2D layer, f32 z, u32 seq);
	void rasterizeFrameBufferLine(std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, f32 thickness, const FrameBufferColor& color, Layer2D layer, f32 z, u32 seq);
	void rasterizeFrameBufferBlit(std::vector<u8>& pixels, const BlitterSource& source, f32 dstX, f32 dstY, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const FrameBufferColor& color, Layer2D layer, f32 z, u32 seq);
	void copyFrameBufferRect(std::vector<u8>& pixels, i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, Layer2D layer, f32 z, u32 seq);

	friend struct VdpGles2Blitter;

};

} // namespace bmsx
