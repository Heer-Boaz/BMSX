#include "audio/resources.h"

#include "audio/soundmaster.h"
#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <utility>

namespace bmsx {

void refreshAudioResources(
	SoundMaster& soundMaster,
	Runtime& runtime,
	const RuntimeAssets& assets,
	const MachineManifest&,
	const u8* systemRomData,
	const u8* cartRomData
) {
	const f32 volume = soundMaster.masterVolume();
	Runtime* boundRuntime = &runtime;
	const RuntimeAssets* boundAssets = &assets;
	auto audioResolver = [boundRuntime, boundAssets, systemRomData, cartRomData](const AssetId& id) -> AudioDataView {
		if (boundRuntime->machine().memory().hasAsset(id)) {
			const auto& entry = boundRuntime->machine().memory().getAssetEntry(id);
			if (entry.type == Memory::AssetType::Audio && entry.baseSize > 0) {
				return AudioDataView{ boundRuntime->machine().memory().getAudioData(entry), entry.frames };
			}
		}
		const AudioAsset* asset = boundAssets->getAudio(id);
		if (!asset) {
			throw BMSX_RUNTIME_ERROR("Audio asset not found: " + id);
		}
		if (!asset->bytes.empty()) {
			return AudioDataView{ asset->bytes.data() + asset->dataOffset, asset->frames };
		}
		const std::string& payloadId = asset->rom.payloadId.value();
		const u8* payloadBase = nullptr;
		if (payloadId == "system") {
			payloadBase = systemRomData;
		} else if (payloadId == "cart") {
			payloadBase = cartRomData;
		} else {
			throw BMSX_RUNTIME_ERROR("Unsupported audio payload id: " + payloadId);
		}
		const i32 start = asset->rom.start.value();
		const u8* wavBase = payloadBase + static_cast<size_t>(start);
		return AudioDataView{ wavBase + asset->dataOffset, asset->frames };
	};
	soundMaster.init(assets, volume, std::move(audioResolver));
}

} // namespace bmsx
