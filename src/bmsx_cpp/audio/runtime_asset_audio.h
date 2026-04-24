#pragma once

#include "machine/memory/memory.h"
#include <vector>

namespace bmsx {

class SoundMaster;

namespace RuntimeAssetAudio {

void syncDirtyRuntimeAudioAssets(const std::vector<Memory::AssetEntry*>& dirtyAssets, SoundMaster& soundMaster);

} // namespace RuntimeAssetAudio

} // namespace bmsx
