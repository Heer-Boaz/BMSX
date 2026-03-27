#pragma once

#include "cpu.h"
#include "io.h"
#include "memory.h"
#include "../rompack/rompack.h"
#include "../render/shared/render_types.h"
#include "../utils/scratchbatch.h"
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

class VDP : public Memory::VramWriter, public Memory::VdpIoHandler {
public:
	explicit VDP(Memory& memory);

	void initializeRegisters();
	void syncRegisters();
	void setDitherType(i32 type);
	i32 getDitherType() const { return m_lastDitherType; }
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void beginFrame();
	void submitOamEntry(const OamEntry& entry);
	void clearBackOamBuffer();
	void clearBackPatBuffer();
	void submitPatEntry(const PatEntry& entry);
	void clearBackBgMap();
	void beginBgMapLayerWrite(i32 layerIndex, const BgMapHeader& header);
	void submitBgMapTile(i32 layerIndex, i32 col, i32 row, const BgMapEntry& entry);
	void swapOamBuffers();
	void swapPatBuffers();
	void swapBgMapBuffers();
	uint32_t getBgMapFrontBase() const { return m_bgMapFrontBase; }
	uint32_t getBgMapBackBase() const { return m_bgMapBackBase; }
	uint32_t getPatFrontBase() const { return m_patFrontBase; }
	uint32_t getPatBackBase() const { return m_patBackBase; }
	void setOamReadSource(bool useBackBuffer);
	i32 frontOamCount() const;
	i32 backOamCount() const;
	bool hasFrontOamContent() const;
	bool hasBackOamContent() const;
	bool hasFront2dContent() const;
	bool hasBack2dContent() const;
	i32 beginSpriteOamRead() const;
	i32 beginBgMap2dRead() const;
	i32 beginOamPat2dRead() const;
	i32 begin2dRead() const;
	void forEachOamEntry(const std::function<void(const OamEntry&, size_t)>& fn) const;
	void forEachSortedBgMap2dEntry(const std::function<void(const OamEntry&, size_t)>& fn) const;
	void forEachOamPat2dEntry(const std::function<void(const OamEntry&, size_t)>& fn) const;
	void forEach2dEntry(const std::function<void(const OamEntry&, size_t)>& fn) const;
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
	struct BgMapLayerRetainedState {
		BgMapHeader header{};
		std::array<BgMapEntry, VDP_BGMAP_TILE_CAPACITY> tiles{};
		i32 enabledCount = 0;
		ScratchBatch<OamEntry> drawEntries{64u};
		bool drawEntriesDirty = false;
	};
	struct BgMapSortedReadRun {
		uint32_t layerIndex = 0;
		i32 sourceIndexStart = 0;
		i32 count = 0;
		f32 z = 0.0f;
	};
	struct BgMapSortedReadState {
		std::array<BgMapSortedReadRun, VDP_BGMAP_LAYER_COUNT> runs{};
		uint32_t runCount = 0;
		i32 count = 0;
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
	std::array<bool, VDP_BGMAP_LAYER_COUNT> m_bgMapBackLayerPending{};
	std::array<bool, VDP_BGMAP_LAYER_COUNT> m_bgMapBackLayerRewritePending{};
	std::array<std::array<u8, VDP_BGMAP_TILE_CAPACITY>, VDP_BGMAP_LAYER_COUNT> m_bgMapPatchFlags{};
	std::array<std::array<BgMapEntry, VDP_BGMAP_TILE_CAPACITY>, VDP_BGMAP_LAYER_COUNT> m_bgMapPatchEntries{};
	std::array<ScratchBatch<uint32_t>, VDP_BGMAP_LAYER_COUNT> m_bgMapPatchIndices{
		ScratchBatch<uint32_t>(64u),
		ScratchBatch<uint32_t>(64u),
	};
	std::vector<u8> m_bgMapLayerCopyScratch;
	std::array<ReadSurface, 3> m_readSurfaces{};
	std::array<ReadCache, 3> m_readCaches{};
	uint32_t m_readBudgetBytes = 0;
	bool m_readOverflow = false;
	bool m_dirtyAtlasBindings = false;
	bool m_dirtySkybox = false;
	SkyboxImageIds m_skyboxFaceIds;
	bool m_hasSkybox = false;
	i32 m_lastDitherType = 0;
	uint32_t m_bgMapFrontBase = VDP_BGMAP_FRONT_BASE;
	uint32_t m_bgMapBackBase = VDP_BGMAP_BACK_BASE;
	uint32_t m_patFrontBase = VDP_PAT_FRONT_BASE;
	uint32_t m_patBackBase = VDP_PAT_BACK_BASE;
	std::array<Memory::ImageWriteEntry, 6> m_skyboxSlots{};
	std::array<BgMapLayerRetainedState, VDP_BGMAP_LAYER_COUNT> m_bgMapFrontStates{};
	std::array<BgMapLayerRetainedState, VDP_BGMAP_LAYER_COUNT> m_bgMapBackStates{};
	mutable BgMapSortedReadState m_bgMapSortedReadState{};

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
	uint32_t floatToBits(f32 value) const;
	f32 bitsToFloat(uint32_t value) const;
	uint32_t readOamFrontBase() const;
	uint32_t readOamBackBase() const;
	uint32_t readOamReadSource() const;
	uint32_t activePatBase() const;
	void copyBgMapLayer(uint32_t srcBase, uint32_t dstBase);
	void clearBgMapPatchLayer(uint32_t layerIndex);
	void clearBgMapRetainedState(BgMapLayerRetainedState& state, const BgMapHeader* header = nullptr);
	void copyBgMapRetainedState(BgMapLayerRetainedState& target, const BgMapLayerRetainedState& source);
	void updateBgMapRetainedTile(BgMapLayerRetainedState& state, uint32_t tileIndex, const BgMapEntry& entry);
	BgMapLayerRetainedState& bgMapRetainedStateForRead(uint32_t layerIndex);
	const BgMapLayerRetainedState& bgMapRetainedStateForRead(uint32_t layerIndex) const;
	void rebuildBgMapDrawEntries(BgMapLayerRetainedState& state);
	BgMapSortedReadState& rebuildBgMapSortedReadState();
	void writeOamEntry(uint32_t addr, const OamEntry& entry);
	OamEntry readOamEntry(uint32_t addr) const;
	void writePatHeader(uint32_t base, const PatHeader& header);
	PatHeader readPatHeader(uint32_t base) const;
	void writePatEntry(uint32_t addr, const PatEntry& entry);
	PatEntry readPatEntry(uint32_t addr) const;
	void writeBgMapHeader(uint32_t base, const BgMapHeader& header);
	BgMapHeader readBgMapHeader(uint32_t base) const;
	void writeBgMapEntry(uint32_t addr, const BgMapEntry& entry);
	BgMapEntry readBgMapEntry(uint32_t addr) const;
	f32 unpackColorChannel(uint32_t packed, uint32_t shift) const;
};

} // namespace bmsx
