import { taskGate } from '../core/taskgate';
import type { AssetEntry, Memory } from '../machine/memory/memory';
import type { TextureManager } from './texture_manager';

const runtimeTextureEditGate = taskGate.group('asset:texture-update');

export function syncDirtyRuntimeImageAssets(memory: Memory, dirtyAssets: Iterable<AssetEntry>, texmanager: TextureManager): void {
	for (const entry of dirtyAssets) {
		if (entry.type !== 'image') {
			continue;
		}
		const vramSpan = entry.capacity > 0 ? entry.capacity : 1;
		if (memory.isVramRange(entry.baseAddr, vramSpan)) {
			continue;
		}
		const token = runtimeTextureEditGate.begin({ blocking: false, category: 'texture', tag: `asset:${entry.id}` });
		void texmanager.updateTexturesForKey(entry.id, memory.getImagePixels(entry), entry.regionW, entry.regionH)
			.finally(() => runtimeTextureEditGate.end(token));
	}
}
