#include "machine/memory/asset_memory.h"

#include "machine/memory/asset_images.h"
#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <utility>

namespace bmsx {

void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode) {
	auto& machine = runtime.machine();
	auto& memory = machine.memory();
	if (mode == RuntimeAssetBuildMode::Cart) {
		memory.resetCartAssets();
	} else {
		memory.resetAssetMemory();
	}
	RegisteredImageMemory imageMemory = registerImageMemory(memory, engineAssets, assets);
	machine.vdp().registerVramAssets(std::move(imageMemory.textpageMemory));

	memory.finalizeAssetTable();
	memory.markAllAssetsDirty();
}

} // namespace bmsx
