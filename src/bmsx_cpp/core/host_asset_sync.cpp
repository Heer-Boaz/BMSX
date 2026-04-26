#include "core/host_asset_sync.h"

#include "machine/memory/memory.h"
#include "render/gameview.h"
#include "render/runtime_asset_textures.h"

namespace bmsx {

void flushHostRuntimeAssetEdits(Memory& memory, TextureManager& texmanager, const GameView& view) {
	if (!view.backend()->readyForTextureUpload()) {
		return;
	}
	auto dirtyAssets = memory.consumeDirtyAssets();
	if (dirtyAssets.empty()) {
		return;
	}
	RuntimeAssetTextures::syncDirtyRuntimeImageAssets(memory, dirtyAssets, texmanager);
}

} // namespace bmsx
