import type { RawRomSource } from '../../rompack/source';
import type { CartridgeIndex, CartridgeLayerId, RomLuaAsset } from '../../rompack/format';
import { decodeuint8arr } from '../../common/serializer/binencoder';
import { PROGRAM_IMAGE_ID, toLuaModulePath } from './loader';

export type LuaSourceRecord = RomLuaAsset & { base_src: string; module_path: string };

export type LuaSourceRegistry = {
	path2lua: Record<string, LuaSourceRecord>;
	module2lua: Record<string, LuaSourceRecord>;
	entry_path: string;
	namespace: string;
	projectRootPath: string;
	can_boot_from_source: boolean;
};

export function resolveLuaSourceRecordFromRegistries(path: string, registries: ReadonlyArray<LuaSourceRegistry | null>): LuaSourceRecord | null {
	for (let index = 0; index < registries.length; index += 1) {
		const registry = registries[index];
		if (registry === null) {
			continue;
		}
		const record = registry.path2lua[path];
		if (record) {
			return record;
		}
		const moduleRecord = registry.module2lua[path];
		if (moduleRecord) {
			return moduleRecord;
		}
	}
	return null;
}

export function buildLuaSources(params: { cartSource: RawRomSource; romSource: RawRomSource; index: CartridgeIndex; allowedPayloadIds: CartridgeLayerId[] }): LuaSourceRegistry {
	const { cartSource, romSource, index, allowedPayloadIds } = params;
	const allowedPayloadIdSet = new Set(allowedPayloadIds);
	const activeLuaEntries = romSource.list('lua').filter(entry => allowedPayloadIdSet.has(entry.payload_id));
	const registry: LuaSourceRegistry = {
		path2lua: {},
		module2lua: {},
		entry_path: index.entry_path,
		namespace: index.machine.namespace,
		projectRootPath: index.projectRootPath,
		can_boot_from_source: activeLuaEntries.length > 0,
	};

	for (const activeEntry of activeLuaEntries) {
		const baseEntry = cartSource.getEntry(activeEntry.resid);
		const src = decodeuint8arr(romSource.getBytes(activeEntry));
		const baseSrc = baseEntry ? decodeuint8arr(cartSource.getBytes(baseEntry)) : src;
		const luaAsset: LuaSourceRecord = {
			...activeEntry,
			src,
			base_src: baseSrc,
			module_path: toLuaModulePath(activeEntry.source_path),
			update_timestamp: activeEntry.update_timestamp,
		};
		registry.path2lua[luaAsset.source_path] = luaAsset;
		registry.module2lua[luaAsset.module_path] = luaAsset;
	}

	const entryPath = registry.entry_path;
	if (entryPath.length > 0 && !registry.path2lua[entryPath] && !registry.module2lua[entryPath]) {
		let entryAsset: LuaSourceRecord = null;
		for (const asset of Object.values(registry.path2lua)) {
			if (asset.source_path !== entryPath) {
				continue;
			}
			if (entryAsset !== null && entryAsset.source_path !== asset.source_path) {
				throw new Error(`[LuaSources] Ambiguous lua.entry_path '${entryPath}'.`);
			}
			entryAsset = asset;
		}
		if (entryAsset !== null) {
			registry.path2lua[entryPath] = entryAsset;
			registry.module2lua[entryAsset.module_path] = entryAsset;
		}
	}

	if (Object.keys(registry.path2lua).length === 0) {
		const hasPackedProgram = index.entries.some(entry => entry.resid === PROGRAM_IMAGE_ID);
		if (hasPackedProgram) {
			const stub: LuaSourceRecord = {
				resid: entryPath,
				type: 'lua',
				src: '',
				base_src: '',
				source_path: entryPath,
				module_path: toLuaModulePath(entryPath),
				update_timestamp: 0,
			};
			registry.path2lua[stub.source_path] = stub;
			registry.module2lua[stub.module_path] = stub;
		}
	}

	return registry;
}
