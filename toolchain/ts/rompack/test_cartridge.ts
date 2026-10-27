import { parseSystemRomImage, parseCartridgePackage } from '../../../machine/ts/rompack/image';
import { loadBlua32ToolingImage, type Blua32ToolingImage } from './blua32_media';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { parseLuaChunk } from '../lua/analysis/parse';
import { collectLuaModuleDependencyClosure } from '../lua/compiler/module_graph';
import { toLuaModulePath } from '../lua/module_path';
import {
	buildRelocatableRomAssetSymbolModule,
} from './asset_symbols';
import type { RomAsset } from './assets';
import { readBlua32BiosImports } from './blua32_bios_imports';
import { BLUA32_IMAGE_ID } from './blua32_image';
import {
	buildBlua32Image,
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
	ROM_ASSET_SYMBOL_SOURCE_PATH,
	ROM_GENERATED_MODULE_PATHS,
} from './generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from './gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from './gx_register_module';
import { loadRomAssetList, parseCartridgeIndex } from './loader';
import { applyBlua32LinkValues, type LinkedCartBlua32Image } from './blua32_linker';
import { discoverGuestTestSuite, type GuestTestSuite } from './test_suite';
import type { ScenarioTestSource } from './scenario_test';
import type { RomSourceLayer } from './source';
import { compiledBlua32Sources, readBlua32CompiledSource, type Blua32CompiledSource } from './blua32_sources';

export const TEST_EXECUTION_MODULE_PATH = 'testlib/execution';

export const UNIT_TEST_ENTRY_MODULE_PATH = 'testlib/unit_entry';
const UNIT_TEST_ENTRY_SOURCE = 'module<entry>\nreturn';

/** One captured source namespace, independent of the ROM's packed source directory. */
export type TestCartridgeSourceInput = Blua32CompiledSource & {
	readonly assetId: string;
	readonly sourceFilePath: string;
	readonly updateTimestamp: number | undefined;
};
export type TestCartridgeSourceSelection =
	| { readonly kind: 'packaged' }
	| { readonly kind: 'authored'; readonly entryModulePath: string | undefined;
		readonly modules: ReadonlyMap<string, TestCartridgeSourceInput> };

export type TestCartridgeBuildOptions = {
	readonly sourceSelection: TestCartridgeSourceSelection;
	systemRom: Uint8Array;
	cartridge: Uint8Array;
	companionCartridge?: Uint8Array | null;
	test: ScenarioTestSource;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
};

function romDebugSources(bytes: Uint8Array, entries: readonly RomAsset[], image: Blua32ToolingImage): ReadonlyMap<string, Blua32CompiledSource> {
	const sources = new Map<string, Blua32CompiledSource>();
	if (image.symbols === null) return sources;
	const available = new Map<string, RomAsset>();
	for (const entry of entries) if (entry.type === 'lua') available.set(toLuaModulePath(entry.source_path!), entry);
	for (const path of image.symbols.metadata.compiledModulePaths) {
		const entry = available.get(path);
		if (entry !== undefined) sources.set(path, { displayPath: entry.source_path!,
			content: { kind: 'utf8', bytes: bytes.subarray(entry.start, entry.end) } });
	}
	return sources;
}

export type TestDebugImage = {
	readonly image: Blua32ToolingImage;
	readonly sources: ReadonlyMap<string, Blua32CompiledSource>;
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

export async function buildTestCartridge(
	options: TestCartridgeBuildOptions,
): Promise<BuiltTestCartridge> {
	const [systemIndex, cartridgeIndex] = await Promise.all([
		loadRomAssetList(options.systemRom, 'system'),
		parseCartridgeIndex(options.cartridge),
	]);
	const imageEntry = cartridgeIndex.entries.find(entry => entry.resid === BLUA32_IMAGE_ID)!;
	const biosImports = readBlua32BiosImports(options.systemRom);
	const layer: RomSourceLayer<'cart'> = {
		id: 'cart',
		index: cartridgeIndex,
		bytes: options.cartridge,
	};
	const packedSources = new Map<string, RomAsset>();
	for (const asset of cartridgeIndex.entries) if (asset.type === 'lua') packedSources.set(toLuaModulePath(asset.source_path!), asset);
	let availableSources: ReadonlyMap<string, TestCartridgeSourceInput>;
	let entryModulePath: string | undefined;
	if (options.sourceSelection.kind === 'authored') {
		availableSources = options.sourceSelection.modules;
		entryModulePath = options.sourceSelection.entryModulePath;
	} else {
		const packaged = new Map<string, TestCartridgeSourceInput>();
		for (const [path, asset] of packedSources) if (!ROM_GENERATED_MODULE_PATHS.includes(path)) packaged.set(path, {
			assetId: asset.resid, sourceFilePath: asset.normalized_source_path!, updateTimestamp: asset.update_timestamp,
			displayPath: asset.source_path!, content: { kind: 'utf8', bytes: options.cartridge.subarray(asset.start, asset.end) },
		});
		availableSources = packaged;
		const image = loadBlua32ToolingImage(parseCartridgePackage(options.cartridge), CART_ROM_BASE)!;
		entryModulePath = image.symbols!.metadata.compiledModulePaths[0];
	}
	const testModulePath = toLuaModulePath(options.test.sourcePath);
	const admittedTest = availableSources.get(testModulePath);
	if (admittedTest === undefined) throw new Error(`Test source '${options.test.sourcePath}' is not admitted by this source selection.`);
	const testChunk = parseLuaChunk(options.test.source, testModulePath).chunk;
	const suite = discoverGuestTestSuite(testChunk, options.test.sourcePath);
	const sourceModuleByPath = new Map<string, Blua32SourceModule>([[testModulePath, {
		path: testModulePath, displayPath: options.test.sourcePath, chunk: testChunk, source: options.test.source,
	}]]);
	const loadSourceModule = (modulePath: string): Blua32SourceModule => {
		let module = sourceModuleByPath.get(modulePath);
		if (module !== undefined) return module;
		const input = availableSources.get(modulePath);
		if (input === undefined) throw new Error(`Fixture source module '${modulePath}' is not admitted.`);
		const source = readBlua32CompiledSource(input);
		module = { path: modulePath, displayPath: input.displayPath, source, chunk: parseLuaChunk(source, modulePath).chunk };
		sourceModuleByPath.set(modulePath, module);
		return module;
	};
	let entry: Blua32SourceModule;
	if (suite.kind === 'unit') entry = { path: UNIT_TEST_ENTRY_MODULE_PATH, displayPath: `${UNIT_TEST_ENTRY_MODULE_PATH}.lua`,
		source: UNIT_TEST_ENTRY_SOURCE, chunk: parseLuaChunk(UNIT_TEST_ENTRY_SOURCE, UNIT_TEST_ENTRY_MODULE_PATH).chunk };
	else {
		if (entryModulePath === undefined) throw new Error('An integration fixture requires an admitted gameplay entry.');
		entry = loadSourceModule(entryModulePath);
	}
	const modulePaths = new Set(availableSources.keys());
	const dependencyPaths = new Set([testModulePath, TEST_EXECUTION_MODULE_PATH, ...collectLuaModuleDependencyClosure(
		[entry.chunk, testChunk, loadSourceModule(TEST_EXECUTION_MODULE_PATH).chunk], modulePaths, path => loadSourceModule(path).chunk,
	)]);
	dependencyPaths.delete(entry.path);
	const derivedProgramModules = [entry];
	for (const path of dependencyPaths) derivedProgramModules.push(loadSourceModule(path));
	const sourceReplacements = new Map<string, RomAsset>();
	const sourceAdditions: RomAsset[] = [];
	for (const [path, module] of sourceModuleByPath) {
		const input = availableSources.get(path)!;
		const packed = packedSources.get(path);
		const asset: RomAsset = {
			resid: input.assetId, type: 'lua', source_path: input.displayPath, normalized_source_path: input.sourceFilePath,
			update_timestamp: input.updateTimestamp, program_module: packed === undefined ? false : packed.program_module,
			buffer: utf8Encoder.encode(module.source),
		};
		if (packed === undefined) sourceAdditions.push(asset);
		else sourceReplacements.set(packed.resid, asset);
	}
	const changes: Blua32PublicAssetChanges = {
		assetReplacements: new Map([['lua', sourceReplacements]]), assetAdditions: sourceAdditions,
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
		displayPath: ROM_ASSET_SYMBOL_SOURCE_PATH,
		source: finalAssetModule.source,
	});
	const companionBytes = options.companionCartridge;
	let companion: TestDebugImage | null = null;
	if (companionBytes !== undefined && companionBytes !== null) {
		const companionIndex = await parseCartridgeIndex(companionBytes);
		const image = loadBlua32ToolingImage(parseCartridgePackage(companionBytes), CART_ROM_BASE);
		if (image !== null) companion = { image, sources: romDebugSources(companionBytes, companionIndex.entries, image) };
	}
	const systemImage = loadBlua32ToolingImage(parseSystemRomImage(options.systemRom), SYSTEM_ROM_BASE)!;
	return {
		suite,
		debugImages: [
			{ image: systemImage, sources: romDebugSources(options.systemRom, systemIndex.entries, systemImage) },
			{ image: built.linked,
				sources: compiledBlua32Sources(diagnosticSources) },
			companion,
		],
		entryCodeAddress: built.entryCodeAddress,
		layer: buildBlua32Tail(layer, built.linked, diagnosticSources, changes),
		linked: built.linked,
		diagnosticSources,
	};
}
