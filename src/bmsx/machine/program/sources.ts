import type { RawRomSource } from '../../rompack/source';
import type { CartridgeIndex, CartridgeLayerId, RomLuaAsset } from '../../rompack/format';
import { utf8FatalDecoder } from '../../common/serializer/binencoder';
import { PROGRAM_IMAGE_ID, toLuaModulePath } from './loader';

export type LuaSourceRecord = RomLuaAsset & { base_src: string; module_path: string };
type PackedLuaSourceAsset = RomLuaAsset & { source_path: string; payload_id: CartridgeLayerId };

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

function isAllowedPayloadId(payloadId: CartridgeLayerId, allowedPayloadIds: readonly CartridgeLayerId[]): boolean {
	for (let index = 0; index < allowedPayloadIds.length; index += 1) {
		if (allowedPayloadIds[index] === payloadId) {
			return true;
		}
	}
	return false;
}

export function buildLuaSources(cartSource: RawRomSource, romSource: RawRomSource, index: CartridgeIndex, allowedPayloadIds: readonly CartridgeLayerId[]): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		path2lua: {},
		module2lua: {},
		entry_path: index.entry_path,
		namespace: index.machine.namespace,
		projectRootPath: index.projectRootPath,
		can_boot_from_source: false,
	};

	let sourceCount = 0;
	for (const entry of romSource.list('lua') as PackedLuaSourceAsset[]) {
		if (!isAllowedPayloadId(entry.payload_id, allowedPayloadIds)) {
			continue;
		}
		sourceCount += 1;
		const baseEntry = cartSource.getEntry(entry.resid);
		const src = utf8FatalDecoder.decode(romSource.getBytes(entry));
		const baseSrc = baseEntry ? utf8FatalDecoder.decode(cartSource.getBytes(baseEntry)) : src;
		const luaRecord = entry as LuaSourceRecord;
		luaRecord.src = src;
		luaRecord.base_src = baseSrc;
		luaRecord.module_path = toLuaModulePath(entry.source_path);
		registry.path2lua[luaRecord.source_path] = luaRecord;
		registry.module2lua[luaRecord.module_path] = luaRecord;
	}
	registry.can_boot_from_source = sourceCount > 0;

	if (sourceCount === 0) {
		const entryPath = registry.entry_path;
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
