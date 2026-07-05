import type { ResourceDescriptor } from '../../../../rompack/tooling/resource';
import { machineManager } from '../../../../core/machine_manager';

export function findResourceDescriptorForChunk(path: string): ResourceDescriptor | null {
	for (const registry of machineManager.sourceState.luaSourceRegistries) {
		const asset = registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: false };
		}
	}
	return null;
}
