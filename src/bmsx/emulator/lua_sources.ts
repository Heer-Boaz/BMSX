import type { RawAssetSource } from '../rompack/asset_source';
import type { CartridgeIndex, CartridgeLayerId, RomLuaAsset } from '../rompack/rompack';
import { decodeuint8arr } from '../serializer/binencoder';
import { PROGRAM_ASSET_ID } from './program_asset';

export type LuaSourceRecord = RomLuaAsset & { base_src: string };

export type LuaSourceRegistry = {
	path2lua: Record<string, LuaSourceRecord>;
	entry_path: string;
	namespace: string;
	can_boot_from_source: boolean;
};

export function buildLuaSources(params: { cartSource: RawAssetSource; assetSource: RawAssetSource; index: CartridgeIndex; allowedPayloadIds: CartridgeLayerId[] }): LuaSourceRegistry {
	const { cartSource, assetSource, index, allowedPayloadIds } = params;
	const allowedPayloadIdSet = new Set(allowedPayloadIds);
	const activeLuaEntries = assetSource.list('lua').filter(entry => allowedPayloadIdSet.has(entry.payload_id));
	const registry: LuaSourceRegistry = {
		path2lua: {},
		entry_path: index.entry_path,
		namespace: index.machine.namespace,
		can_boot_from_source: activeLuaEntries.length > 0,
	};

	for (const activeEntry of activeLuaEntries) {
		const baseEntry = cartSource.getEntry(activeEntry.resid);
		const src = decodeuint8arr(assetSource.getBytes(activeEntry));
		const baseSrc = baseEntry ? decodeuint8arr(cartSource.getBytes(baseEntry)) : src;
		const luaAsset: LuaSourceRecord = {
			...activeEntry,
			src,
			base_src: baseSrc,
			update_timestamp: activeEntry.update_timestamp,
		};
		registry.path2lua[luaAsset.source_path] = luaAsset;
	}

	const entryPath = registry.entry_path;
	if (entryPath.length > 0 && !registry.path2lua[entryPath]) {
		let entryAsset: LuaSourceRecord = null;
		for (const asset of Object.values(registry.path2lua)) {
			if (asset.source_path !== entryPath && !asset.source_path.endsWith(`/${entryPath}`)) {
				continue;
			}
			if (entryAsset !== null && entryAsset.source_path !== asset.source_path) {
				throw new Error(`[LuaSources] Ambiguous lua.entry_path '${entryPath}'.`);
			}
			entryAsset = asset;
		}
		if (entryAsset !== null) {
			registry.path2lua[entryPath] = entryAsset;
		}
	}

	if (Object.keys(registry.path2lua).length === 0) {
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
