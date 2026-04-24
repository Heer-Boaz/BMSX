#include "render/runtime_asset_textures.h"

#include "machine/memory/memory.h"
#include "render/texture_manager.h"

namespace bmsx {
namespace RuntimeAssetTextures {

void syncDirtyRuntimeImageAssets(Memory& memory, const std::vector<Memory::AssetEntry*>& dirtyAssets, TextureManager& texmanager) {
	for (const auto* entry : dirtyAssets) {
		if (entry->type != Memory::AssetType::Image) {
			continue;
		}
		const uint32_t span = entry->capacity > 0 ? entry->capacity : 1u;
		if (memory.isVramRange(entry->baseAddr, span)) {
			continue;
		}
		texmanager.updateTexturesForAsset(
			entry->id,
			memory.getImagePixels(*entry),
			static_cast<i32>(entry->regionW),
			static_cast<i32>(entry->regionH)
		);
	}
}

} // namespace RuntimeAssetTextures
} // namespace bmsx
