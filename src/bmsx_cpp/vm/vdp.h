#pragma once

#include "cpu.h"
#include "vm_io.h"
#include "vm_memory.h"
#include "../rompack/rompack.h"
#include "../render/shared/render_types.h"
#include <array>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

class RuntimeAssets;
class GameView;

class VDP {
public:
	explicit VDP(VmMemory& memory);

	void initializeRegisters();
	void syncRegisters();
	void setDitherType(i32 type);

	void registerImageAssets(RuntimeAssets& assets, bool keepDecodedData);
	void flushAssetEdits();
	void applyAtlasSlotMapping(const std::array<i32, 2>& slots);
	void commitViewSnapshot(GameView& view);

	const std::array<i32, 2>& atlasSlots() const { return m_slotAtlasIds; }

private:
	VmMemory& m_memory;
	std::unordered_map<i32, std::string> m_atlasResourceById;
	std::unordered_map<i32, std::vector<std::string>> m_atlasViewIdsById;
	std::unordered_map<i32, i32> m_atlasSlotById;
	std::array<i32, 2> m_slotAtlasIds{{-1, -1}};
	bool m_dirtyAtlasBindings = false;
	bool m_dirtySkybox = false;
	SkyboxImageIds m_skyboxFaceIds;
	i32 m_lastDitherType = 0;
};

} // namespace bmsx
