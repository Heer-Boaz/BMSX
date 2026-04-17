#include "machine/runtime/runtime_asset_memory.h"

#include "machine/runtime/runtime.h"
#include "rompack/runtime_assets.h"

#include <algorithm>
#include <vector>

namespace bmsx {

void buildAssetMemory(Runtime& runtime, RuntimeAssets& assets, bool keepDecodedData, RuntimeAssetBuildMode mode) {
	if (mode == RuntimeAssetBuildMode::Cart) {
		runtime.machine().memory().resetCartAssets();
	} else {
		runtime.machine().memory().resetAssetMemory();
	}
	runtime.machine().vdp().registerImageAssets(assets, keepDecodedData);
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
		if (runtime.machine().memory().hasAsset(id)) {
			continue;
		}
		runtime.machine().memory().registerAudioMeta(
			id,
			static_cast<uint32_t>(audioAsset->sampleRate),
			static_cast<uint32_t>(audioAsset->channels),
			static_cast<uint32_t>(audioAsset->bitsPerSample),
			static_cast<uint32_t>(audioAsset->frames),
			static_cast<uint32_t>(audioAsset->dataOffset),
			static_cast<uint32_t>(audioAsset->dataSize)
		);
	}

	runtime.machine().memory().finalizeAssetTable();
	runtime.machine().memory().markAllAssetsDirty();
}

} // namespace bmsx
