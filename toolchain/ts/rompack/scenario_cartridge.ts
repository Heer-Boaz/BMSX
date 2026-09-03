import { utf8FatalDecoder } from '../../../machine/ts/common/serializer/binencoder';
import { CART_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { parseLuaChunk } from '../lua/analysis/parse';
import { collectLuaModuleDependencyClosure } from '../lua/compiler/module_graph';
import { composeLuaSource } from '../lua/compiler/source_map';
import { resolveLuaEntryModuleIndex } from '../lua/entry_module';
import { toLuaModulePath } from '../lua/module_path';
import {
	buildRelocatableRomAssetSymbolModule,
} from './asset_symbols';
import type { RomAsset } from './assets';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	decodeBlua32BiosImports,
} from './blua32_bios_imports';
import { BLUA32_IMAGE_ID } from './blua32_image';
import {
	buildBlua32Image,
	decodeBlua32SourceModules,
	type Blua32SourceModule,
} from './blua32_image_builder';
import {
	buildBlua32Tail,
	layoutBlua32PublicAssets,
	type Blua32PublicAssetChanges,
} from './blua32_tail';
import type { Blua32DiagnosticSourceMap } from './blua32_diagnostics';
import {
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_REGISTER_MODULE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
} from './generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from './gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from './gx_register_module';
import { loadRomAssetList, parseCartridgeIndex } from './loader';
import { applyBlua32LinkValues, type LinkedCartBlua32Image } from './blua32_linker';
import { SCENARIO_GUEST_API_SOURCE, SCENARIO_TEST_LOADER_GLOBAL } from './scenario_guest_api';
import { scenarioTestAssetId, type ScenarioTestSource } from './scenario_test';
import type { RomSourceLayer } from './source';

export const SCENARIO_ENTRY_MODULE_PATH = 'bmsx/scenario_entry';

export type ScenarioCartridgeBuildOptions = {
	systemRom: Uint8Array;
	cartridge: Uint8Array;
	test: ScenarioTestSource;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
};

export type BuiltScenarioCartridge = {
	layer: RomSourceLayer<'cart'>;
	linked: LinkedCartBlua32Image;
	diagnosticSources: Blua32DiagnosticSourceMap;
};

const utf8Encoder = new TextEncoder();

function collectLuaSourceAssets(payload: Uint8Array, entries: ReadonlyArray<RomAsset>): RomAsset[] {
	const assets: RomAsset[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type !== 'lua') {
			continue;
		}
		const asset: RomAsset = {
			...entry,
			buffer: payload.subarray(entry.start!, entry.end!),
		};
		if (entry.compiled_start !== undefined) {
			asset.compiled_buffer = payload.subarray(entry.compiled_start, entry.compiled_end!);
		}
		assets.push(asset);
	}
	return assets;
}

export async function buildScenarioCartridge(
	options: ScenarioCartridgeBuildOptions,
): Promise<BuiltScenarioCartridge> {
	const [systemIndex, cartridgeIndex] = await Promise.all([
		loadRomAssetList(options.systemRom, 'system'),
		parseCartridgeIndex(options.cartridge),
	]);
	const systemImportsEntry = systemIndex.entries.find(
		entry => entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID,
	)!;
	const imageEntry = cartridgeIndex.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
	const biosImports = decodeBlua32BiosImports(
		options.systemRom.subarray(systemImportsEntry.start, systemImportsEntry.end),
	);
	const layer: RomSourceLayer<'cart'> = {
		id: 'cart',
		index: cartridgeIndex,
		bytes: options.cartridge,
	};
	const luaSourceAssets = collectLuaSourceAssets(options.cartridge, cartridgeIndex.entries);
	const programModules = decodeBlua32SourceModules(luaSourceAssets);
	const entryCandidate = programModules[resolveLuaEntryModuleIndex(programModules)];
	const entrySource = entryCandidate.source;
	const entrySourcePath = entryCandidate.displayPath;
	const sourceAssetByModulePath = new Map<string, RomAsset>();
	for (let index = 0; index < luaSourceAssets.length; index += 1) {
		const asset = luaSourceAssets[index];
		sourceAssetByModulePath.set(toLuaModulePath(asset.source_path), asset);
	}
	const sourceModuleByPath = new Map<string, Blua32SourceModule>();
	for (let index = 0; index < programModules.length; index += 1) {
		const module = programModules[index];
		sourceModuleByPath.set(module.path, module);
	}
	const modulePaths = new Set(sourceAssetByModulePath.keys());
	const loadSourceModule = (modulePath: string): Blua32SourceModule => {
		const cached = sourceModuleByPath.get(modulePath);
		if (cached !== undefined) {
			return cached;
		}
		const asset = sourceAssetByModulePath.get(modulePath)!;
		const source = utf8FatalDecoder.decode(asset.buffer!);
		const module: Blua32SourceModule = {
			path: modulePath,
			displayPath: asset.source_path!,
			chunk: parseLuaChunk(source, modulePath).chunk!,
			source,
		};
		sourceModuleByPath.set(modulePath, module);
		return module;
	};
	const testChunk = parseLuaChunk(options.test.source, options.test.sourcePath).chunk!;
	const testDependencyPaths = collectLuaModuleDependencyClosure(
		[testChunk],
		modulePaths,
		modulePath => loadSourceModule(modulePath).chunk,
	);
	const derivedProgramModules = programModules.slice();
	for (let index = 0; index < testDependencyPaths.length; index += 1) {
		const modulePath = testDependencyPaths[index];
		const asset = sourceAssetByModulePath.get(modulePath)!;
		if (asset.compiled_buffer !== undefined) {
			continue;
		}
		derivedProgramModules.push(loadSourceModule(modulePath));
	}
	const firstLineEnd = entrySource.indexOf('\n') + 1;
	const entryComposition = composeLuaSource(SCENARIO_ENTRY_MODULE_PATH, [
		{
			kind: 'source',
			rangePath: entryCandidate.chunk.range.path,
			displayPath: entrySourcePath,
			source: entrySource,
			endOffset: firstLineEnd,
		},
		{
			kind: 'generated',
			source: `${SCENARIO_TEST_LOADER_GLOBAL} = function()`,
		},
		{
			kind: 'generated',
			source: SCENARIO_GUEST_API_SOURCE,
		},
		{
			kind: 'source',
			rangePath: toLuaModulePath(options.test.sourcePath),
			displayPath: options.test.sourcePath,
			source: options.test.source,
		},
		{ kind: 'generated', source: 'end' },
		{
			kind: 'source',
			rangePath: entryCandidate.chunk.range.path,
			displayPath: entrySourcePath,
			source: entrySource,
			startOffset: firstLineEnd,
		},
	]);
	const changes: Blua32PublicAssetChanges = {
		assetEdit: [
			'lua',
			scenarioTestAssetId(options.test.sourcePath),
			utf8Encoder.encode(options.test.source),
		],
	};
	const imageByteCount = imageEntry.end! - imageEntry.start!;
	const compileAssets = layoutBlua32PublicAssets(layer, imageByteCount, changes);
	const assetModule = buildRelocatableRomAssetSymbolModule(
		compileAssets.entries,
		'cart',
		imageEntry.start!,
	);
	const built = buildBlua32Image({
		luaModules: derivedProgramModules,
		entryComposition,
		generatedLuaModules: [
			{
				path: ROM_ASSET_SYMBOL_MODULE_PATH,
				source: assetModule.source,
				linkValues: assetModule.linkValues,
			},
			{ path: GX_DISPLAY_PRESET_MODULE_PATH, source: GX_DISPLAY_PRESET_MODULE_SOURCE },
			{ path: GX_REGISTER_MODULE_PATH, source: GX_REGISTER_MODULE_SOURCE },
		],
		loadAddress: CART_ROM_BASE + imageEntry.start!,
		ramByteCount: options.ramByteCount,
		optLevel: options.optLevel,
		traceStatements: 'emit',
		domain: 'cart',
		biosImports,
	});
	const finalAssets = layoutBlua32PublicAssets(layer, built.linked.bytes.byteLength, changes);
	const finalAssetModule = buildRelocatableRomAssetSymbolModule(
		finalAssets.entries,
		'cart',
		imageEntry.start!,
	);
	applyBlua32LinkValues(
		built.linked,
		built.object.link.constValueRelocs,
		ROM_ASSET_SYMBOL_MODULE_PATH,
		finalAssetModule.linkValues,
	);
	const diagnosticSources = new Map(built.diagnosticSources);
	diagnosticSources.set(ROM_ASSET_SYMBOL_MODULE_PATH, {
		displayPath: `${ROM_ASSET_SYMBOL_MODULE_PATH}.lua`,
		source: finalAssetModule.source,
	});
	return {
		layer: buildBlua32Tail(layer, built.linked, diagnosticSources, changes),
		linked: built.linked,
		diagnosticSources,
	};
}
