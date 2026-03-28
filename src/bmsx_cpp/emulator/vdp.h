#pragma once

#include "cpu.h"
#include "io.h"
#include "memory.h"
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

class VDP : public Memory::VramWriter, public Memory::VdpIoHandler {
public:
	explicit VDP(Memory& memory);

	void initializeRegisters();
	void syncRegisters();
	void setDitherType(i32 type);
	i32 getDitherType() const { return m_lastDitherType; }
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void beginFrame();
	void discardFrameBufferOps();
	void clearFrameBuffer(const Color& color);
	void queueFrameBufferSpriteHandle(u32 handle, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color);
	void queueFrameBufferRect(bool fill, f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color);
	void queueFrameBufferLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness);
	void queueFrameBufferPoly(const std::vector<f32>& points, f32 z, const Color& color, f32 thickness, Layer2D layer);
	void queueFrameBufferGlyphs(const std::vector<std::string>& lines, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, RenderLayer layer);
	void flushFrameBufferOps();
	void ensureFrameBufferSurfaceReady();
	const char* getFrameBufferTextureKey() const { return FRAMEBUFFER_TEXTURE_KEY; }
	uint32_t readVdpStatus() override;
	uint32_t readVdpData() override;

	void registerImageAssets(RuntimeAssets& assets, bool keepDecodedData);
	void restoreVramSlotTextures();
	void captureVramTextureSnapshots();
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	void attachImgDecController(ImgDecController& controller);
	void setSkyboxImages(const SkyboxImageIds& ids);
	void clearSkybox();
	std::optional<SkyboxImageIds> skyboxFaceIds() const;
	void commitViewSnapshot(GameView& view);
	uint32_t trackedUsedVramBytes() const;
	uint32_t trackedTotalVramBytes() const;

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
	enum class FrameBufferCommandType : u8 {
		Sprite,
		Fill,
		Line,
	};
	struct FrameBufferCommand {
		FrameBufferCommandType type = FrameBufferCommandType::Sprite;
		u32 handle = 0;
		f32 x0 = 0.0f;
		f32 y0 = 0.0f;
		f32 x1 = 0.0f;
		f32 y1 = 0.0f;
		f32 z = 0.0f;
		Layer2D layer = Layer2D::World;
		f32 scaleX = 1.0f;
		f32 scaleY = 1.0f;
		f32 thickness = 1.0f;
		bool flipH = false;
		bool flipV = false;
		u32 sourceIndex = 0;
		FrameBufferColor color{};
	};
	struct FrameBufferImageSource {
		const u8* pixels = nullptr;
		uint32_t regionX = 0;
		uint32_t regionY = 0;
		uint32_t stride = 0;
		uint32_t width = 0;
		uint32_t height = 0;
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
	std::array<ReadSurface, 3> m_readSurfaces{};
	std::array<ReadCache, 3> m_readCaches{};
	uint32_t m_readBudgetBytes = 0;
	bool m_readOverflow = false;
	bool m_dirtyAtlasBindings = false;
	bool m_dirtySkybox = false;
	SkyboxImageIds m_skyboxFaceIds;
	bool m_hasSkybox = false;
	i32 m_lastDitherType = 0;
	std::vector<u8> m_frameBufferPixels;
	std::vector<FrameBufferCommand> m_frameBufferCommands;
	FrameBufferColor m_frameBufferClearColor{0, 0, 0, 255};
	bool m_frameBufferClearRequested = false;
	uint32_t m_frameBufferSourceIndex = 0;
	uint32_t m_frameBufferWidth = 0;
	uint32_t m_frameBufferHeight = 0;
	std::array<Memory::ImageWriteEntry, 6> m_skyboxSlots{};

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
	uint32_t nextVramMachineSeed() const;
	uint32_t nextVramBootSeed() const;
	void fillVramGarbageScratch(u8* data, size_t length, VramGarbageStream& stream) const;
	void seedVramStaging();
	void seedVramSlotTexture(VramSlot& slot);
	void setSlotTextureSize(const std::string& textureKey, uint32_t width, uint32_t height);
	void restoreVramSlotTexture(const Memory::AssetEntry& entry, const std::string& textureKey);
	FrameBufferColor packFrameBufferColor(const Color& color) const;
	void resetFrameBufferCommands();
	void ensureFrameBufferSurface();
	const u8* getFrameBufferSourcePixels(const Memory::AssetEntry& entry) const;
	FrameBufferImageSource resolveFrameBufferImageSource(u32 handle) const;
	void blendFrameBufferPixel(size_t index, u8 r, u8 g, u8 b, u8 a);
	void rasterizeFrameBufferFill(const FrameBufferCommand& command);
	void rasterizeFrameBufferLine(const FrameBufferCommand& command);
	void rasterizeFrameBufferSprite(const FrameBufferCommand& command);
};

} // namespace bmsx
