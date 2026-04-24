#pragma once

#include "machine/memory/memory.h"
#include <vector>

namespace bmsx {

class TextureManager;

namespace RuntimeAssetTextures {

void syncDirtyRuntimeImageAssets(Memory& memory, const std::vector<Memory::AssetEntry*>& dirtyAssets, TextureManager& texmanager);

} // namespace RuntimeAssetTextures

} // namespace bmsx
