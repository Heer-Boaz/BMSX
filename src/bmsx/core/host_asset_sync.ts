import type { Memory } from '../machine/memory/memory';
import { syncDirtyRuntimeImageAssets } from '../render/runtime_asset_textures';
import type { TextureManager } from '../render/texture_manager';

export function flushHostRuntimeAssetEdits(memory: Memory, texmanager: TextureManager): void {
	const dirtyAssets = memory.consumeDirtyAssets();
	if (dirtyAssets.length === 0) {
		return;
	}
	syncDirtyRuntimeImageAssets(memory, dirtyAssets, texmanager);
}
