import type { RawRomSource } from '../../toolchain/ts/rompack/source';
import {
	BLUA32_FIRMWARE_MODULE_PATH,
	BLUA32_FIRMWARE_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
	ROM_ASSET_SYMBOL_SOURCE_PATH,
	ROM_GENERATED_MODULE_PATHS,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import type {
	CartridgeIndex,
	RomAsset,
	RomLuaAsset,
} from '../../toolchain/ts/rompack/assets';
import type { RomImageDomain } from '../../machine/ts/rompack/image';
import { utf8FatalDecoder } from '../../machine/ts/common/serializer/binencoder';
import {
	buildRomAssetSymbolModuleSourceFromSymbols,
	collectRomAssetSymbols,
} from '../../toolchain/ts/rompack/asset_symbols';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { resolveLuaEntryModuleIndex } from '../../toolchain/ts/lua/entry_module';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';

export type LuaSourceRecord = RomLuaAsset & { base_src: string; base_update_timestamp: number; module_path: string; generated: boolean };
type PackedLuaSourceAsset = RomLuaAsset & { source_path: string; payload_id: RomImageDomain };

export type LuaSourceRegistry = {
	records: LuaSourceRecord[];
	path2lua: Record<string, LuaSourceRecord>;
	module2lua: Record<string, LuaSourceRecord>;
	entrySourcePath: string;
	projectRootPath: string;
	can_boot_from_source: boolean;
	revision: number;
};

export type LuaSourceMatch = {
	registry: LuaSourceRegistry;
	record: LuaSourceRecord;
};

export function registerLuaSourceRecord(registry: LuaSourceRegistry, record: LuaSourceRecord): void {
	const previous = registry.path2lua[record.source_path];
	if (previous) {
		registry.records[registry.records.indexOf(previous)] = record;
	} else {
		registry.records.push(record);
	}
	registry.path2lua[record.source_path] = record;
	registry.module2lua[record.module_path] = record;
	registry.revision += 1;
}

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

export function buildLuaSources(
	cartSource: RawRomSource,
	romSource: RawRomSource,
	index: CartridgeIndex,
	payloadId: RomImageDomain,
): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: '',
		projectRootPath: index.projectRootPath,
		can_boot_from_source: false,
		revision: 0,
	};

	let sourceCount = 0;
	const entryCandidates: Array<{ record: LuaSourceRecord; chunk: LuaChunk }> = [];
	for (const entry of romSource.list('lua') as PackedLuaSourceAsset[]) {
		if (entry.payload_id !== payloadId) {
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
		luaRecord.generated = ROM_GENERATED_MODULE_PATHS.includes(luaRecord.module_path);
		registerLuaSourceRecord(registry, luaRecord);
		entryCandidates.push({
			record: luaRecord,
			chunk: parseLuaChunk(src, entry.source_path).chunk!,
		});
	}
	registry.can_boot_from_source = sourceCount > 0;
	if (sourceCount > 0) {
		registry.entrySourcePath = entryCandidates[resolveLuaEntryModuleIndex(entryCandidates)].record.source_path;
		const assetEntries: RomAsset[] = [];
		const entries = romSource.list();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.payload_id === payloadId) {
				assetEntries.push(entry);
			}
		}
		const generatedModulePath = payloadId === 'system'
			? SYSTEM_ASSET_SYMBOL_MODULE_PATH
			: ROM_ASSET_SYMBOL_MODULE_PATH;
		const generatedSourcePath = payloadId === 'system'
			? SYSTEM_ASSET_SYMBOL_SOURCE_PATH
			: ROM_ASSET_SYMBOL_SOURCE_PATH;
		const source = buildRomAssetSymbolModuleSourceFromSymbols(
			collectRomAssetSymbols(assetEntries, payloadId),
		);
		const assetSymbols: LuaSourceRecord = {
			resid: generatedModulePath,
			type: 'lua',
			src: source,
			base_src: source,
			base_update_timestamp: 0,
			source_path: generatedSourcePath,
			module_path: generatedModulePath,
			update_timestamp: 0,
			generated: true,
		};
		registerLuaSourceRecord(registry, assetSymbols);
		if (payloadId === 'system') {
			registerLuaSourceRecord(registry, {
				resid: BLUA32_FIRMWARE_MODULE_PATH,
				type: 'lua',
				src: BLUA32_FIRMWARE_MODULE_SOURCE,
				base_src: BLUA32_FIRMWARE_MODULE_SOURCE,
				base_update_timestamp: 0,
				source_path: BLUA32_FIRMWARE_SOURCE_PATH,
				module_path: BLUA32_FIRMWARE_MODULE_PATH,
				update_timestamp: 0,
				generated: true,
			});
		}
	}

	return registry;
}
