import { utf8FatalDecoder } from '../../../machine/ts/common/serializer/binencoder';
import { parseSystemRomImage, parseCartridgePackage } from '../../../machine/ts/rompack/image';
import { loadBlua32ToolingImage, type Blua32ToolingImage } from './blua32_media';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { parseLuaChunk } from '../lua/analysis/parse';
import { collectLuaModuleDependencyClosure } from '../lua/compiler/module_graph';
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
import { discoverGuestTestSuite, type GuestTestSuite } from './test_suite';
import { scenarioTestAssetId, type ScenarioTestSource } from './scenario_test';
import type { RomSourceLayer } from './source';

export const TEST_EXECUTION_MODULE_PATH = 'testlib/execution';

export const UNIT_TEST_ENTRY_MODULE_PATH = 'testlib/unit_entry';
const UNIT_TEST_ENTRY_SOURCE = 'module<entry>\nreturn';

export type TestCartridgeBuildOptions = {
	sourceOnlyModules?: readonly ScenarioTestSource[];
	systemRom: Uint8Array;
	cartridge: Uint8Array;
	companionCartridge?: Uint8Array | null;
	test: ScenarioTestSource;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
};

export type TestDebugSource = {
	readonly displayPath: string;
	content: { kind: 'text'; text: string } | { kind: 'utf8'; bytes: Uint8Array };
};

/** Decode immutable ROM source only when an inspector actually requests it. */
export function readTestDebugSource(source: TestDebugSource): string {
	if (source.content.kind === 'utf8') source.content = { kind: 'text', text: utf8FatalDecoder.decode(source.content.bytes) };
	return source.content.text;
}

function romDebugSources(bytes: Uint8Array, entries: readonly RomAsset[]): ReadonlyMap<string, TestDebugSource> {
	const sources = new Map<string, TestDebugSource>();
	for (const entry of entries) if (entry.type === 'lua') {
		sources.set(toLuaModulePath(entry.source_path!), { displayPath: entry.source_path!,
			content: { kind: 'utf8', bytes: bytes.subarray(entry.start, entry.end) } });
	}
	return sources;
}

export type TestDebugImage = {
	readonly image: Blua32ToolingImage;
	readonly sources: ReadonlyMap<string, TestDebugSource>;
};

export type BuiltTestCartridge = {
	layer: RomSourceLayer<'cart'>;
	debugImages: readonly [TestDebugImage, TestDebugImage, TestDebugImage | null];
	linked: LinkedCartBlua32Image;
	diagnosticSources: Blua32DiagnosticSourceMap;
	suite: GuestTestSuite;
	entryCodeAddress: number;
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

export async function buildTestCartridge(
	options: TestCartridgeBuildOptions,
): Promise<BuiltTestCartridge> {
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
	const sourceIndex = new Map(luaSourceAssets.map((asset, index) => [asset.source_path, index]));
	const sourceReplacements = new Map<string, RomAsset>();
	for (const source of options.sourceOnlyModules ?? []) {
		const index = sourceIndex.get(source.sourcePath)!;
		const asset = { ...luaSourceAssets[index], buffer: utf8Encoder.encode(source.source) };
		luaSourceAssets[index] = asset;
		sourceReplacements.set(asset.resid, asset);
	}
	const programModules = decodeBlua32SourceModules(luaSourceAssets);
	const entryCandidate = programModules[resolveLuaEntryModuleIndex(programModules)];
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
	const testModulePath = toLuaModulePath(options.test.sourcePath);
	const testChunk = parseLuaChunk(options.test.source, testModulePath).chunk;
	const suite = discoverGuestTestSuite(testChunk, options.test.sourcePath);
	const testDependencyPaths = new Set([TEST_EXECUTION_MODULE_PATH, ...collectLuaModuleDependencyClosure(
		[testChunk, loadSourceModule(TEST_EXECUTION_MODULE_PATH).chunk],
		modulePaths,
		modulePath => loadSourceModule(modulePath).chunk,
	)]);
	const derivedProgramModules = programModules.slice();
	for (const modulePath of testDependencyPaths) {
		const asset = sourceAssetByModulePath.get(modulePath)!;
		if (asset.compiled_buffer !== undefined) {
			continue;
		}
		derivedProgramModules.push(loadSourceModule(modulePath));
	}
	derivedProgramModules.push({
		path: testModulePath, displayPath: options.test.sourcePath,
		chunk: testChunk, source: options.test.source,
	});
	if (suite.kind === 'unit') {
		derivedProgramModules.splice(derivedProgramModules.indexOf(entryCandidate), 1);
		derivedProgramModules.push({
			path: UNIT_TEST_ENTRY_MODULE_PATH, displayPath: `${UNIT_TEST_ENTRY_MODULE_PATH}.lua`,
			chunk: parseLuaChunk(UNIT_TEST_ENTRY_SOURCE, UNIT_TEST_ENTRY_MODULE_PATH).chunk,
			source: UNIT_TEST_ENTRY_SOURCE,
		});
	}
	const changes: Blua32PublicAssetChanges = {
		assetReplacements: new Map([['lua', sourceReplacements]]),
		assetEdits: [[
			'lua',
			scenarioTestAssetId(options.test.sourcePath),
			utf8Encoder.encode(options.test.source),
		]],
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
		preloadModules: [testModulePath, TEST_EXECUTION_MODULE_PATH],
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
	const companionBytes = options.companionCartridge;
	let companion: TestDebugImage | null = null;
	if (companionBytes !== undefined && companionBytes !== null) {
		const companionIndex = await parseCartridgeIndex(companionBytes);
		const image = loadBlua32ToolingImage(parseCartridgePackage(companionBytes), CART_ROM_BASE);
		if (image !== null) companion = { image, sources: romDebugSources(companionBytes, companionIndex.entries) };
	}
	return {
		suite,
		debugImages: [
			{ image: loadBlua32ToolingImage(parseSystemRomImage(options.systemRom), SYSTEM_ROM_BASE)!,
				sources: romDebugSources(options.systemRom, systemIndex.entries) },
			{ image: built.linked,
				sources: new Map([...diagnosticSources].map(([module, source]) => [module,
					{ displayPath: source.displayPath, content: { kind: 'text', text: source.source } }])) },
			companion,
		],
		entryCodeAddress: built.entryCodeAddress,
		layer: buildBlua32Tail(layer, built.linked, diagnosticSources, changes),
		linked: built.linked,
		diagnosticSources,
	};
}
