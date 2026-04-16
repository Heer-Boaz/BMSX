import type { ResourceDescriptor } from '../../../../machine/runtime/types';
import { Runtime } from '../../../../machine/runtime/runtime';
import * as runtimeLuaPipeline from '../../../runtime/runtime_lua_pipeline';

export function findResourceDescriptorForChunk(path: string): ResourceDescriptor | null {
	const runtime = Runtime.instance;
	const registries = runtimeLuaPipeline.listLuaSourceRegistries(runtime);
	for (const entry of registries) {
		const asset = entry.registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: entry.readOnly };
		}
	}
	return null;
}
