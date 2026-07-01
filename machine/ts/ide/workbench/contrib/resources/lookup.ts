import type { ResourceDescriptor } from '../../../../rompack/tooling/resource';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function findResourceDescriptorForChunk(runtime: Runtime, path: string): ResourceDescriptor | null {
	for (const registry of runtime.luaSourceRegistries) {
		const asset = registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: false };
		}
	}
	return null;
}
