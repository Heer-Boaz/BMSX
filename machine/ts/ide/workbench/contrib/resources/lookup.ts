import type { ResourceDescriptor } from '../../../../rompack/tooling/resource';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function findResourceDescriptorForChunk(runtime: Runtime, path: string): ResourceDescriptor | null {
	const registries = luaPipeline.listLuaSourceRegistries(runtime);
	for (const registry of registries) {
		const asset = registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: false };
		}
	}
	return null;
}
