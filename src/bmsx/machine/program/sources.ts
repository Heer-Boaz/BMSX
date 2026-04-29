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
		const luaRecord = activeEntry as LuaSourceRecord;
		luaRecord.src = src;
		luaRecord.base_src = baseSrc;
		luaRecord.module_path = toLuaModulePath(activeEntry.source_path);
		luaRecord.update_timestamp = typeof activeEntry.update_timestamp === 'number' ? activeEntry.update_timestamp : 0;
		registry.path2lua[luaRecord.source_path] = luaRecord;
		registry.module2lua[luaRecord.module_path] = luaRecord;
	}

	const entryPath = registry.entry_path;
	if (entryPath.length > 0 && !registry.path2lua[entryPath] && !registry.module2lua[entryPath]) {
		let entryRecord: LuaSourceRecord = null;
		for (const record of Object.values(registry.path2lua)) {
			if (record.source_path !== entryPath) {
				continue;
			}
			if (entryRecord !== null && entryRecord.source_path !== record.source_path) {
				throw new Error(`[LuaSources] Ambiguous lua.entry_path '${entryPath}'.`);
			}
			entryRecord = record;
		}
		if (entryRecord !== null) {
			registry.path2lua[entryPath] = entryRecord;
			registry.module2lua[entryRecord.module_path] = entryRecord;
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
