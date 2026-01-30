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

class VDP : public Memory::VramWriter {
public:
	explicit VDP(Memory& memory);

	void initializeRegisters();
	void syncRegisters();
	void setDitherType(i32 type);
	void writeVram(uint32_t addr, const u8* data, size_t length) override;

	void registerImageAssets(RuntimeAssets& assets, bool keepDecodedData);
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	void commitViewSnapshot(GameView& view);

	const std::array<i32, 2>& atlasSlots() const { return m_slotAtlasIds; }

private:
	struct VramSlot {
		uint32_t baseAddr = 0;
		uint32_t capacity = 0;
		Memory::AssetEntry* entry = nullptr;
		std::string textureKey;
	};

	Memory& m_memory;
	std::unordered_map<i32, std::string> m_atlasResourceById;
	std::unordered_map<i32, std::vector<std::string>> m_atlasViewIdsById;
	std::unordered_map<i32, i32> m_atlasSlotById;
	std::array<i32, 2> m_slotAtlasIds{{-1, -1}};
	std::vector<VramSlot> m_vramSlots;
	std::vector<u8> m_vramStaging;
	bool m_dirtyAtlasBindings = false;
	bool m_dirtySkybox = false;
	SkyboxImageIds m_skyboxFaceIds;
	i32 m_lastDitherType = 0;

	void registerVramSlot(Memory::AssetEntry& entry, const std::string& textureKey);
	const VramSlot& findVramSlot(uint32_t addr, size_t length) const;
};

} // namespace bmsx
