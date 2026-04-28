import type { ResourceDescriptor } from '../../../../rompack/resource';
import * as luaPipeline from '../../../runtime/lua_pipeline';

export function findResourceDescriptorForChunk(path: string): ResourceDescriptor | null {
	const registries = luaPipeline.listLuaSourceRegistries();
	for (const entry of registries) {
		const asset = entry.registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: entry.readOnly };
		}
	}
	return null;
}
