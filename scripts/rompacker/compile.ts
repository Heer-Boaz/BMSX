import { resolve } from 'node:path';
import type { RomBuildOutput } from '../../toolchain/ts/rompack/build_manifest';
import type { PreparedUnit, BuildProgress } from './build';
import {
	BIOS_FUNCTION_EXPORTS,
	SYSTEM_ROM_ASSET_OFFSET,
	SYSTEM_ROM_NAME,
} from '../../toolchain/ts/rompack/system';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileAudioEventResources } from './audioeventcompiler';
import type { CartRomBlua32Tail } from './rombuilder';
import { buildRomAssetSymbolModuleSourceFromSymbols, collectRomAssetSymbols } from '../../toolchain/ts/rompack/asset_symbols';
import {
	BLUA32_FIRMWARE_MODULE_PATH,
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_REGISTER_MODULE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { decodeBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { buildScenarioTestSourceAssets } from './scenario_test_sources';
import { getRomManifest } from './build_inputs';

export async function compileSystem(prepared: PreparedUnit, outputDirectory: string, progress: BuildProgress): Promise<readonly RomBuildOutput[]> {
	const { inputs, sourceFiles, recipe: { debug, optLevel, projectRoot: virtualRoot } } = prepared;
	const { buildRomBlua32Tail, createTextureAtlases, finalizeRompack, generateRomAssets,
		getResMetaList, getResourcesList } = await import('./rombuilder');
	const { lintCartSources } = await import('./cart_lua_linter_runtime');

	progress('Lint system');
	await lintCartSources({
		sources: sourceFiles.map(file => inputs.files.get(resolve(file))!),
		profile: 'bios',
	});

	progress('Scan system resources');
	const BIOSResMetaList = await getResMetaList(inputs, {
		domain: 'system',
		sourceOnlyLuaRootFiles: [],
		sourceOnlyLuaModuleRoots: [],
		extraLuaFiles: sourceFiles,
		virtualRoot,
	});
	progress('Load system resources');
	const BIOSResources = await getResourcesList(BIOSResMetaList);
	progress('Build system textures');
	await createTextureAtlases(BIOSResources);
	compileAudioEventResources(BIOSResources);
	progress('Build system assets');
	const BIOSRomAssets = await generateRomAssets(BIOSResources, progress);
	const BIOSLayout = layoutRomPrefix(
		BIOSRomAssets,
		debug,
		null,
		SYSTEM_ROM_ASSET_OFFSET,
	);
	const BIOSAssetSymbolModuleSource = buildRomAssetSymbolModuleSourceFromSymbols(
		collectRomAssetSymbols(BIOSLayout.entries, 'system'),
	);
	const BIOSBlua32 = buildRomBlua32Tail(BIOSRomAssets, {
		generatedLuaModules: [
			{
				path: SYSTEM_ASSET_SYMBOL_MODULE_PATH,
				source: BIOSAssetSymbolModuleSource,
			},
			{
				path: BLUA32_FIRMWARE_MODULE_PATH,
				source: BLUA32_FIRMWARE_MODULE_SOURCE,
			},
			{
				path: GX_DISPLAY_PRESET_MODULE_PATH,
				source: GX_DISPLAY_PRESET_MODULE_SOURCE,
			},
			{
				path: GX_REGISTER_MODULE_PATH,
				source: GX_REGISTER_MODULE_SOURCE,
			},
		],
		includeSymbols: debug,
		optLevel,
		systemAssetEndOffset: BIOSLayout.nextOffset,
		biosExports: BIOS_FUNCTION_EXPORTS,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		domain: 'system',
	});
	progress('Write system ROM');
	return finalizeRompack(SYSTEM_ROM_NAME, { projectRootPath: virtualRoot, debug, blua32: BIOSBlua32, layout: BIOSLayout, outputDirectory });
}

export async function compileCart(prepared: PreparedUnit, outputDirectory: string, name: string, biosImportsBytes: Buffer, progress: BuildProgress): Promise<readonly RomBuildOutput[]> {
	const { inputs, sourceFiles: cartSourceFiles, librarySourceFiles, testLibraryFiles, scenarioSourceFiles,
		recipe: { debug, optLevel, projectRoot: virtualRoot } } = prepared;
	const allLibraryFiles = prepared.allLibraryFiles;
	const romManifest = getRomManifest(inputs);
	if (romManifest === null) throw new Error(`ROM manifest missing in ${virtualRoot}`);
	const biosImports = cartSourceFiles.length === 0 ? undefined : decodeBlua32BiosImports(biosImportsBytes);
	const { TEST_EXECUTION_MODULE_PATH } = await import('../../toolchain/ts/rompack/test_cartridge');
	const { buildRomBlua32Tail, createTextureAtlases, finalizeRompack, generateRomAssets,
		getResMetaList, getResourcesList } = await import('./rombuilder');
	const { lintCartSources } = await import('./cart_lua_linter_runtime');
	progress('Scan resources');
	const romResMetaList = await getResMetaList(inputs, {
		domain: 'cart',
		extraLuaFiles: cartSourceFiles,
		libraryLuaFiles: allLibraryFiles,
		sourceOnlyLuaRootFiles: scenarioSourceFiles,
		sourceOnlyLuaModuleRoots: scenarioSourceFiles.length === 0 ? [] : [TEST_EXECUTION_MODULE_PATH],
		virtualRoot,
	});
	// Build resources
	progress('Load resources');
	const resources = await getResourcesList(romResMetaList);

	progress('Generate GX textures');
	await createTextureAtlases(resources, progress);

	// Compile AEM resources against the loaded audio and data resources.
	compileAudioEventResources(resources);

	progress('Generate ROM assets');
	const romAssets = await generateRomAssets(resources, progress);
	romAssets.push(...buildScenarioTestSourceAssets(scenarioSourceFiles.map(file => inputs.files.get(resolve(file))!)));
	const romLayout = layoutRomPrefix(romAssets, debug, romManifest);
	let blua32: CartRomBlua32Tail | null = null;
	if (biosImports !== undefined) {
		const assetSymbols = collectRomAssetSymbols(romLayout.entries, 'cart');
		const assetSymbolModuleSource = buildRomAssetSymbolModuleSourceFromSymbols(assetSymbols);
		blua32 = buildRomBlua32Tail(romAssets, {
			includeSymbols: debug,
			optLevel,
			imageOffset: romLayout.nextOffset,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes,
			domain: 'cart',
			biosImports,
			generatedLuaModules: [
				{
					path: ROM_ASSET_SYMBOL_MODULE_PATH,
					source: assetSymbolModuleSource,
				},
				{
					path: GX_DISPLAY_PRESET_MODULE_PATH,
					source: GX_DISPLAY_PRESET_MODULE_SOURCE,
				},
				{
					path: GX_REGISTER_MODULE_PATH,
					source: GX_REGISTER_MODULE_SOURCE,
				},
			],
		});
	}
	if (biosImports !== undefined) {
		progress('Lint cart + shared Lua');
			await lintCartSources({ sources: cartSourceFiles.map(file => inputs.files.get(resolve(file))!), profile: 'cart' });
			await lintCartSources({ sources: [...librarySourceFiles, ...testLibraryFiles].map(file => inputs.files.get(resolve(file))!), profile: 'bios' });
	}

	progress('Write cartridge ROM');
	return finalizeRompack(name, { projectRootPath: virtualRoot, status: progress, debug, blua32, layout: romLayout, outputDirectory });
}
