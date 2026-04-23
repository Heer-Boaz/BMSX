import { $ } from '../../core/engine';
import { taskGate } from '../../core/taskgate';
import type { Memory } from '../../machine/memory/memory';

const runtimeAssetEditGate = taskGate.group('asset:update');

export function flushRuntimeAssetEdits(memory: Memory): void {
	const dirty = memory.consumeDirtyAssets();
	if (dirty.length === 0) {
		return;
	}
	for (let index = 0; index < dirty.length; index += 1) {
		const entry = dirty.get(index);
		if (entry.type === 'image') {
			const vramSpan = entry.capacity > 0 ? entry.capacity : 1;
			if (memory.isVramRange(entry.baseAddr, vramSpan)) {
				continue;
			}
			const token = runtimeAssetEditGate.begin({ blocking: false, category: 'texture', tag: `asset:${entry.id}` });
			void $.texmanager.updateTexturesForKey(entry.id, memory.getImagePixels(entry), entry.regionW, entry.regionH)
				.finally(() => runtimeAssetEditGate.end(token));
		} else if (entry.type === 'audio') {
			$.sndmaster.invalidateClip(entry.id);
		}
	}
}
