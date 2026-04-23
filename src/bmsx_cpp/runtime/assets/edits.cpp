#include "runtime/assets/edits.h"

#include "core/engine.h"
#include "core/primitives.h"
#include "machine/memory/memory.h"
#include "render/gameview.h"
#include "render/texture_manager.h"

namespace bmsx {

void flushRuntimeAssetEdits(Memory& memory) {
	auto* view = EngineCore::instance().view();
	if (!view->backend()->readyForTextureUpload()) {
		return;
	}
	auto dirty = memory.consumeDirtyAssets();
	if (dirty.empty()) {
		return;
	}
	auto* texmanager = EngineCore::instance().texmanager();
	for (const auto* entry : dirty) {
		if (entry->type != Memory::AssetType::Image) {
			continue;
		}
		const uint32_t span = entry->capacity > 0 ? entry->capacity : 1u;
		if (memory.isVramRange(entry->baseAddr, span)) {
			continue;
		}
		texmanager->updateTexturesForAsset(
			entry->id,
			memory.getImagePixels(*entry),
			static_cast<i32>(entry->regionW),
			static_cast<i32>(entry->regionH)
		);
	}
}

} // namespace bmsx
