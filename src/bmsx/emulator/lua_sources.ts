import type { RawAssetSource } from '../rompack/asset_source';
import type { CartridgeIndex, RomLuaAsset } from '../rompack/rompack';
import { decodeuint8arr } from '../serializer/binencoder';
import { PROGRAM_ASSET_ID } from './program_asset';

export type LuaSourceRecord = RomLuaAsset & { base_src: string };

export type LuaSourceRegistry = {
	path2lua: Record<string, LuaSourceRecord>;
	entry_path: string;
	namespace: string;
};

export function buildLuaSources(params: { cartSource: RawAssetSource; assetSource: RawAssetSource; index: CartridgeIndex }): LuaSourceRegistry {
	const { cartSource, assetSource, index } = params;
	const registry: LuaSourceRegistry = {
		path2lua: {},
		entry_path: index.manifest.lua.entry_path,
		namespace: index.manifest.machine.namespace,
	};

	for (const asset of index.assets) {
		if (asset.type !== 'lua') {
			continue;
		}
		const baseEntry = cartSource.getEntry(asset.resid);
		if (!baseEntry) {
			continue;
		}
		const activeEntry = assetSource.getEntry(asset.resid);
		if (!activeEntry) {
			continue;
		}
		const baseSrc = decodeuint8arr(cartSource.getBytes(baseEntry));
		const src = decodeuint8arr(assetSource.getBytes(activeEntry));
		const luaAsset: LuaSourceRecord = {
			...activeEntry,
			src,
			base_src: baseSrc,
			update_timestamp: activeEntry.update_timestamp,
		};
		registry.path2lua[luaAsset.source_path] = luaAsset;
	}

	if (Object.keys(registry.path2lua).length === 0) {
		const entryPath = index.manifest.lua.entry_path;
		const hasProgramAsset = index.assets.some(asset => asset.resid === PROGRAM_ASSET_ID);
		if (hasProgramAsset) {
			const stub: LuaSourceRecord = {
				resid: entryPath,
				type: 'lua',
				src: '',
				base_src: '',
				source_path: entryPath,
				update_timestamp: 0,
			};
			registry.path2lua[stub.source_path] = stub;
		}
	}

	return registry;
}
