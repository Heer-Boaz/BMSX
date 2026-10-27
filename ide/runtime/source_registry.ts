import type { RawRomSource } from '../../toolchain/ts/rompack/source';
import {
	BLUA32_FIRMWARE_MODULE_PATH,
	BLUA32_FIRMWARE_SOURCE_PATH,
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_DISPLAY_PRESET_SOURCE_PATH,
	GX_REGISTER_MODULE_PATH,
	GX_REGISTER_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
	ROM_ASSET_SYMBOL_SOURCE_PATH,
	ROM_GENERATED_MODULE_PATHS,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
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
import type { Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { isScenarioTestAsset } from '../../toolchain/ts/rompack/scenario_test';

/** Authoring role; importing a library does not change its role or packed provenance. */
export type LuaSourceKind = 'project' | 'library' | 'source-only';

/** Explicit source membership and namespace mapping supplied by project admission. */
export type LuaSourceRoot = {
	readonly path: string;
	readonly resourcePathPrefix: string;
	readonly modulePathPrefix: string;
	readonly structured: boolean;
	readonly sourceKind: LuaSourceKind;
};

export type LuaSourceRecord = RomLuaAsset & {
	readonly sourceKind: LuaSourceKind;
	base_src: string;
	base_update_timestamp: number;
	module_path: string;
	generated: boolean;
	/** Membership in the packed source directory, not the current executable. */
	readonly program_module: boolean;
};
type PackedLuaSourceAsset = RomLuaAsset & {
	payload_id: RomImageDomain;
	program_module: boolean;
};

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

/** Source-only projects use the same registry owner as packed-source admission. */
export function createLuaSourceRegistry(projectRootPath: string, entrySourcePath: string): LuaSourceRegistry {
	return { records: [], path2lua: {}, module2lua: {}, entrySourcePath, projectRootPath,
		can_boot_from_source: false, revision: 0 };
}

/** Capture written paths with their installed text; later working-copy renames do not change code provenance. */
export function captureInstalledLuaSources(
	registry: LuaSourceRegistry, compiledModulePaths: readonly string[],
): ReadonlyMap<string, Blua32CompiledSource> {
	const sources = new Map<string, Blua32CompiledSource>();
	for (const modulePath of compiledModulePaths) {
		const record = registry.module2lua[modulePath];
		// A source-bearing image can still omit individual embedded source files.
		if (record !== undefined) sources.set(modulePath, {
			displayPath: record.source_path, content: { kind: 'text', text: record.src },
		});
	}
	return sources;
}

type SourceChangeListener = (path: string | undefined) => void;
const sourceChangeListeners = new WeakMap<LuaSourceRegistry, Set<SourceChangeListener>>();

/** A source revision may change without a retained editor model (discovery, reload, generated sources). */
export function onDidChangeLuaSourceRegistry(registry: LuaSourceRegistry, listener: SourceChangeListener): () => void {
	let listeners = sourceChangeListeners.get(registry);
	if (listeners === undefined) sourceChangeListeners.set(registry, listeners = new Set());
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function advanceLuaSourceRevision(registry: LuaSourceRegistry, path?: string): void {
	registry.revision += 1;
	const listeners = sourceChangeListeners.get(registry);
	if (listeners !== undefined) for (const listener of listeners) listener(path);
}

export function registerLuaSourceRecord(registry: LuaSourceRegistry, record: LuaSourceRecord): void {
	const previous = registry.path2lua[record.source_path];
	if (previous) {
		registry.records[registry.records.indexOf(previous)] = record;
	} else {
		registry.records.push(record);
	}
	registry.path2lua[record.source_path] = record;
	registry.module2lua[record.module_path] = record;
	advanceLuaSourceRevision(registry, record.source_path);
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
	entrySourcePath: string | undefined,
	sourceRoots: readonly LuaSourceRoot[],
): LuaSourceRegistry {
	const registry = createLuaSourceRegistry(index.projectRootPath, '');

	let programSourceCount = 0;
	for (const entry of romSource.list('lua') as PackedLuaSourceAsset[]) {
		if (entry.payload_id !== payloadId) {
			continue;
		}
		const baseEntry = cartSource.getEntry(entry.resid);
		const src = utf8FatalDecoder.decode(romSource.getBytes(entry));
		const baseSrc = baseEntry ? utf8FatalDecoder.decode(cartSource.getBytes(baseEntry)) : src;
		const modulePath = toLuaModulePath(entry.source_path);
		const sourceRoot = sourceRoots.find(root => entry.normalized_source_path === root.path
			|| entry.normalized_source_path.startsWith(`${root.path}/`));
		const luaRecord: LuaSourceRecord = {
			...entry, src, base_src: baseSrc,
			base_update_timestamp: entry.update_timestamp,
			module_path: modulePath,
			generated: ROM_GENERATED_MODULE_PATHS.includes(modulePath),
			sourceKind: isScenarioTestAsset(entry) ? 'source-only'
				: sourceRoot === undefined ? entry.program_module ? 'project' : 'source-only' : sourceRoot.sourceKind,
			program_module: entry.program_module,
		};
		registerLuaSourceRecord(registry, luaRecord);
		if (luaRecord.program_module) {
			programSourceCount += 1;
		}
	}
	const entrySource = entrySourcePath === undefined ? undefined : registry.module2lua[toLuaModulePath(entrySourcePath)];
	registry.can_boot_from_source = programSourceCount > 0 && entrySource !== undefined;
	if (entrySource !== undefined) registry.entrySourcePath = entrySource.source_path;
	if (programSourceCount > 0) {
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
			normalized_source_path: generatedSourcePath,
			module_path: generatedModulePath,
			update_timestamp: 0,
			generated: true,
			sourceKind: 'project',
			program_module: true,
		};
		registerLuaSourceRecord(registry, assetSymbols);
		registerLuaSourceRecord(registry, {
			resid: GX_DISPLAY_PRESET_MODULE_PATH,
			type: 'lua',
			src: GX_DISPLAY_PRESET_MODULE_SOURCE,
			base_src: GX_DISPLAY_PRESET_MODULE_SOURCE,
			base_update_timestamp: 0,
			source_path: GX_DISPLAY_PRESET_SOURCE_PATH,
			normalized_source_path: GX_DISPLAY_PRESET_SOURCE_PATH,
			module_path: GX_DISPLAY_PRESET_MODULE_PATH,
			update_timestamp: 0,
			generated: true,
			sourceKind: 'project',
			program_module: true,
		});
		registerLuaSourceRecord(registry, {
			resid: GX_REGISTER_MODULE_PATH,
			type: 'lua',
			src: GX_REGISTER_MODULE_SOURCE,
			base_src: GX_REGISTER_MODULE_SOURCE,
			base_update_timestamp: 0,
			source_path: GX_REGISTER_SOURCE_PATH,
			normalized_source_path: GX_REGISTER_SOURCE_PATH,
			module_path: GX_REGISTER_MODULE_PATH,
			update_timestamp: 0,
			generated: true,
			sourceKind: 'project',
			program_module: true,
		});
		if (payloadId === 'system') {
			registerLuaSourceRecord(registry, {
				resid: BLUA32_FIRMWARE_MODULE_PATH,
				type: 'lua',
				src: BLUA32_FIRMWARE_MODULE_SOURCE,
				base_src: BLUA32_FIRMWARE_MODULE_SOURCE,
				base_update_timestamp: 0,
				source_path: BLUA32_FIRMWARE_SOURCE_PATH,
				normalized_source_path: BLUA32_FIRMWARE_SOURCE_PATH,
				module_path: BLUA32_FIRMWARE_MODULE_PATH,
				update_timestamp: 0,
				generated: true,
				sourceKind: 'project',
				program_module: true,
			});
		}
	}

	return registry;
}
