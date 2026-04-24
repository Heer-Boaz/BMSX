import type { SoundMaster } from './soundmaster';
import type { AssetEntry } from '../machine/memory/memory';

export function syncDirtyRuntimeAudioAssets(dirtyAssets: Iterable<AssetEntry>, sndmaster: SoundMaster): void {
	for (const entry of dirtyAssets) {
		if (entry.type === 'audio') {
			sndmaster.invalidateClip(entry.id);
		}
	}
}
