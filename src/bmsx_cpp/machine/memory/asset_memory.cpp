#include "machine/memory/asset_memory.h"

#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <algorithm>
#include <vector>

namespace bmsx {

void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, bool keepDecodedData, RuntimeAssetBuildMode mode) {
	auto& machine = runtime.machine();
	auto& memory = machine.memory();
	if (mode == RuntimeAssetBuildMode::Cart) {
		memory.resetCartAssets();
	} else {
		memory.resetAssetMemory();
	}
	machine.vdp().registerImageAssets(engineAssets, assets, keepDecodedData);
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
