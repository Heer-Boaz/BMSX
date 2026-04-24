#include "audio/runtime_asset_audio.h"

#include "audio/soundmaster.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace RuntimeAssetAudio {

void syncDirtyRuntimeAudioAssets(const std::vector<Memory::AssetEntry*>& dirtyAssets, SoundMaster& soundMaster) {
	for (const auto* entry : dirtyAssets) {
		if (entry->type == Memory::AssetType::Audio) {
			soundMaster.invalidateClip(entry->id);
		}
	}
}

} // namespace RuntimeAssetAudio
} // namespace bmsx
