#pragma once

#include "cpu.h"
#include "io.h"
#include "memory.h"
#include "../rompack/rompack.h"
#include "../render/shared/render_types.h"
#include <array>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

class RuntimeAssets;
class GameView;

class VDP : public Memory::VramWriter, public Memory::VdpIoHandler {
public:
	explicit VDP(Memory& memory);

	void initializeRegisters();
	void syncRegisters();
	void setDitherType(i32 type);
	void writeVram(uint32_t addr, const u8* data, size_t length) override;
	void beginFrame();
	uint32_t readVdpStatus() override;
	uint32_t readVdpData() override;

	void registerImageAssets(RuntimeAssets& assets, bool keepDecodedData);
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	void commitViewSnapshot(GameView& view);

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
	struct VramSlot {
		uint32_t baseAddr = 0;
		uint32_t capacity = 0;
		std::string assetId;
		std::string textureKey;
		uint32_t surfaceId = 0;
		uint32_t textureWidth = 0;
		uint32_t textureHeight = 0;
	};

	Memory& m_memory;
	std::unordered_map<i32, std::string> m_atlasResourceById;
	std::unordered_map<i32, std::vector<std::string>> m_atlasViewIdsById;
	std::unordered_map<i32, i32> m_atlasSlotById;
	std::array<i32, 2> m_slotAtlasIds{{-1, -1}};
	std::vector<VramSlot> m_vramSlots;
	std::vector<u8> m_vramStaging;
	std::vector<u8> m_vramGarbageScratch;
	std::array<u8, 4> m_vramSeedPixel{{0, 0, 0, 0}};
	uint32_t m_vramGarbageSeed = 0;
	std::array<ReadSurface, 3> m_readSurfaces{};
	std::array<ReadCache, 3> m_readCaches{};
	uint32_t m_readBudgetBytes = 0;
	bool m_readOverflow = false;
	bool m_dirtyAtlasBindings = false;
	bool m_dirtySkybox = false;
	SkyboxImageIds m_skyboxFaceIds;
	i32 m_lastDitherType = 0;

	void registerVramSlot(const Memory::AssetEntry& entry, const std::string& textureKey, uint32_t surfaceId);
	void registerReadSurface(uint32_t surfaceId, const std::string& assetId, const std::string& textureKey);
	const ReadSurface& getReadSurface(uint32_t surfaceId) const;
	void invalidateReadCache(uint32_t surfaceId);
	ReadCache& getReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y);
	void prefetchReadCache(uint32_t surfaceId, const ReadSurface& surface, uint32_t x, uint32_t y);
	std::vector<u8> readSurfacePixels(const ReadSurface& surface, uint32_t x, uint32_t y, uint32_t width, uint32_t height);
	VramSlot& findVramSlot(uint32_t addr, size_t length);
	const VramSlot& findVramSlot(uint32_t addr, size_t length) const;
	void ensureVramSlotTextureSize(VramSlot& slot);
	VramSlot& getVramSlotByTextureKey(const std::string& textureKey);
	uint32_t deriveVramGarbageSeed(const std::string& textureKey) const;
	uint32_t nextVramGarbageSeed() const;
	uint32_t advanceGarbageState(uint32_t state) const;
	uint32_t fillGarbageBuffer(u8* data, size_t length, uint32_t seed) const;
	void seedVramStaging(uint32_t seed);
	void seedVramSlotTexture(VramSlot& slot, uint32_t seed);
	void setSlotTextureSize(const std::string& textureKey, uint32_t width, uint32_t height);
};

} // namespace bmsx
