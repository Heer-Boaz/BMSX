#include "machine/memory/asset_memory.h"

#include "core/primitives.h"
#include "machine/memory/asset_images.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

namespace bmsx {

uint32_t romBaseForPayloadId(std::string_view payloadId) {
	if (payloadId == "system") {
		return SYSTEM_ROM_BASE;
	}
	if (payloadId == "overlay") {
		return OVERLAY_ROM_BASE;
	}
	if (payloadId == "cart") {
		return CART_ROM_BASE;
	}
	throw BMSX_RUNTIME_ERROR("Asset payload id '" + std::string(payloadId) + "' has no ROM base.");
}

void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode) {
	auto& machine = runtime.machine();
	auto& memory = machine.memory();
	if (mode == RuntimeAssetBuildMode::Cart) {
		memory.resetCartAssets();
	} else {
		memory.resetAssetMemory();
	}
	RegisteredImageMemory imageMemory = registerImageMemory(memory, engineAssets, assets);
	machine.vdp().registerVramAssets(std::move(imageMemory.atlasMemory));
	restoreEngineAtlas(memory, *imageMemory.engineAtlasAsset);
	std::vector<const AudioAsset*> audioAssets;
	audioAssets.reserve(assets.audio.size());
	for (const auto& entry : assets.audio) {
		const auto& audioAsset = entry.second;
		audioAssets.push_back(&audioAsset);
	}
	std::sort(audioAssets.begin(), audioAssets.end(), [](const AudioAsset* lhs, const AudioAsset* rhs) {
		return lhs->id < rhs->id;
	});
	for (const auto* audioAsset : audioAssets) {
		const std::string& id = audioAsset->id;
		if (memory.hasAsset(id)) {
			continue;
		}
		memory.registerAudioMeta(
			id,
			static_cast<uint32_t>(audioAsset->sampleRate),
			static_cast<uint32_t>(audioAsset->channels),
			static_cast<uint32_t>(audioAsset->bitsPerSample),
			static_cast<uint32_t>(audioAsset->frames),
			static_cast<uint32_t>(audioAsset->dataOffset),
			static_cast<uint32_t>(audioAsset->dataSize)
		);
	}

	memory.finalizeAssetTable();
	memory.markAllAssetsDirty();
}

} // namespace bmsx
