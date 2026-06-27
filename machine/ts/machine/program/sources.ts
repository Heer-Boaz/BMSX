import type { RawRomSource } from '../../rompack/source';
import type { CartridgeIndex, CartridgeLayerId, RomAsset, RomLuaAsset } from '../../rompack/format';
import { utf8FatalDecoder } from '../../common/serializer/binencoder';
import { buildRomAssetSymbolModuleSource, ROM_ASSET_SYMBOL_MODULE_PATH, ROM_ASSET_SYMBOL_SOURCE_PATH } from '../../rompack/asset_symbols';
import { PROGRAM_IMAGE_ID, toLuaModulePath } from './loader';

export const DEFAULT_SYSTEM_PROJECT_ROOT_PATH = 'machine/ts';

export type LuaSourceRecord = RomLuaAsset & { base_src: string; base_update_timestamp: number; module_path: string };
type PackedLuaSourceAsset = RomLuaAsset & { source_path: string; payload_id: CartridgeLayerId };

export type LuaSourceRegistry = {
	path2lua: Record<string, LuaSourceRecord>;
	module2lua: Record<string, LuaSourceRecord>;
	entry_path: string;
	namespace: string;
	projectRootPath: string;
	can_boot_from_source: boolean;
};

export type LuaSourceMatch = {
	registry: LuaSourceRegistry;
	record: LuaSourceRecord;
};

export function resolveLuaSourceRecord(registry: LuaSourceRegistry, path: string): LuaSourceRecord | null {
	const record = registry.path2lua[path];
	if (record) {
		return record;
	}
	const moduleRecord = registry.module2lua[path];
	if (moduleRecord) {
		return moduleRecord;
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
	let emitAssetSymbolModule = false;
	for (let index = 0; index < allowedPayloadIds.length; index += 1) {
		if (allowedPayloadIds[index] !== 'system') {
			emitAssetSymbolModule = true;
		}
	}
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
		luaRecord.base_update_timestamp = entry.update_timestamp ?? 0;
		luaRecord.module_path = toLuaModulePath(entry.source_path);
		registry.path2lua[luaRecord.source_path] = luaRecord;
		registry.module2lua[luaRecord.module_path] = luaRecord;
	}
	registry.can_boot_from_source = sourceCount > 0;

	if (emitAssetSymbolModule) {
		const assetEntries: RomAsset[] = [];
		const entries = romSource.list();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (isAllowedPayloadId(entry.payload_id, allowedPayloadIds)) {
				assetEntries.push(entry);
			}
		}
		const source = buildRomAssetSymbolModuleSource(assetEntries, false);
		const assetSymbols: LuaSourceRecord = {
			resid: ROM_ASSET_SYMBOL_MODULE_PATH,
			type: 'lua',
			src: source,
			base_src: source,
			base_update_timestamp: 0,
			source_path: ROM_ASSET_SYMBOL_SOURCE_PATH,
			module_path: ROM_ASSET_SYMBOL_MODULE_PATH,
			update_timestamp: 0,
		};
		registry.path2lua[assetSymbols.source_path] = assetSymbols;
		registry.module2lua[assetSymbols.module_path] = assetSymbols;
	}

	if (sourceCount === 0) {
		const entryPath = registry.entry_path;
		const hasPackedProgram = index.entries.some(entry => entry.resid === PROGRAM_IMAGE_ID);
		if (hasPackedProgram) {
			const stub: LuaSourceRecord = {
				resid: entryPath,
				type: 'lua',
				src: '',
				base_src: '',
				base_update_timestamp: 0,
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
