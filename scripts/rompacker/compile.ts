import { resolve } from 'node:path';
import type { RomBuildOutput } from '../../toolchain/ts/rompack/build_manifest';
import type { PreparedUnit } from './build';
import type { BuildReporter } from '../lib/build_reporter';
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
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';

export async function compileSystem(prepared: PreparedUnit, outputDirectory: string, progress: BuildReporter): Promise<readonly RomBuildOutput[]> {
	const { inputs, sourceFiles, recipe: { debug, optLevel, projectRoot: virtualRoot } } = prepared;
	const { buildRomBlua32Tail, createTextureAtlases, finalizeRompack, generateRomAssets,
		getResMetaList, getResourcesList } = await import('./rombuilder');
	const { lintCartSources } = await import('./cart_lua_linter_runtime');

	progress({ type: 'phase', message: 'Lint system' });
	await lintCartSources({
		sources: sourceFiles.map(file => inputs.files.get(resolve(file))!),
		profile: 'bios',
	});

	progress({ type: 'phase', message: 'Scan system resources' });
	const BIOSResMetaList = await getResMetaList(inputs, {
		domain: 'system',
		sourceOnlyLuaRootFiles: [],
		sourceOnlyLuaModuleRoots: [],
		extraLuaFiles: sourceFiles,
		virtualRoot,
	}, progress);
	progress({ type: 'phase', message: 'Load system resources' });
	const BIOSResources = await getResourcesList(BIOSResMetaList);
	progress({ type: 'phase', message: 'Build system textures' });
	await createTextureAtlases(BIOSResources, progress);
	progress({ type: 'phase', message: 'Compile system audio events' });
	compileAudioEventResources(BIOSResources);
	progress({ type: 'phase', message: 'Build system assets' });
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
	progress({ type: 'phase', message: 'Compile system Lua' });
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
	progress({ type: 'phase', message: 'Write system ROM' });
	return finalizeRompack(SYSTEM_ROM_NAME, { projectRootPath: virtualRoot, status: progress, debug, blua32: BIOSBlua32, layout: BIOSLayout, outputDirectory });
}

export async function compileCart(prepared: PreparedUnit, outputDirectory: string, name: string, biosImportsBytes: Buffer, progress: BuildReporter): Promise<readonly RomBuildOutput[]> {
	const { inputs, sourceFiles: cartSourceFiles, librarySourceFiles, testLibraryFiles, scenarioSourceFiles,
		recipe: { debug, optLevel, projectRoot: virtualRoot } } = prepared;
	const allLibraryFiles = prepared.allLibraryFiles;
	const romManifest = getRomManifest(inputs);
	if (romManifest === null) throw new Error(`ROM manifest missing in ${virtualRoot}`);
	const biosImports = cartSourceFiles.length === 0 ? undefined : decodeBlua32BiosImports(biosImportsBytes);
	const { buildRomBlua32Tail, createTextureAtlases, finalizeRompack, generateRomAssets,
		getResMetaList, getResourcesList, resolveVirtualSourcePath } = await import('./rombuilder');
	const { lintCartSources } = await import('./cart_lua_linter_runtime');
	progress({ type: 'phase', message: 'Scan resources' });
	const romResMetaList = await getResMetaList(inputs, {
		domain: 'cart',
		extraLuaFiles: cartSourceFiles,
		libraryLuaFiles: allLibraryFiles,
		sourceOnlyLuaRootFiles: scenarioSourceFiles,
		// Debug media supports authoring the first scenario, not only replaying packed suites.
		// The runner and recorders remain source-only: no gameplay initialization or code cost.
		sourceOnlyLuaModuleRoots: testLibraryFiles.map(file => toLuaModulePath(resolveVirtualSourcePath(file, virtualRoot))),
		virtualRoot,
	}, progress);
	// Build resources
	progress({ type: 'phase', message: 'Load resources' });
	const resources = await getResourcesList(romResMetaList);

	progress({ type: 'phase', message: 'Generate GX textures' });
	await createTextureAtlases(resources, progress);

	// Compile AEM resources against the loaded audio and data resources.
	progress({ type: 'phase', message: 'Compile audio events' });
	compileAudioEventResources(resources);

	progress({ type: 'phase', message: 'Generate ROM assets' });
	const romAssets = await generateRomAssets(resources, progress);
	romAssets.push(...buildScenarioTestSourceAssets(scenarioSourceFiles.map(file => inputs.files.get(resolve(file))!), virtualRoot));
	const romLayout = layoutRomPrefix(romAssets, debug, romManifest);
	let blua32: CartRomBlua32Tail | null = null;
	if (biosImports !== undefined) {
		const assetSymbols = collectRomAssetSymbols(romLayout.entries, 'cart');
		const assetSymbolModuleSource = buildRomAssetSymbolModuleSourceFromSymbols(assetSymbols);
		progress({ type: 'phase', message: 'Compile cartridge Lua' });
		blua32 = buildRomBlua32Tail(romAssets, {
			includeSymbols: debug,
			hostTraceChannels: debug ? ['event.emit'] : [],
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
		progress({ type: 'phase', message: 'Lint cart + shared Lua' });
			await lintCartSources({ sources: cartSourceFiles.map(file => inputs.files.get(resolve(file))!), profile: 'cart' });
			await lintCartSources({ sources: [...librarySourceFiles, ...testLibraryFiles].map(file => inputs.files.get(resolve(file))!), profile: 'bios' });
	}

	progress({ type: 'phase', message: 'Write cartridge ROM' });
	return finalizeRompack(name, { projectRootPath: virtualRoot, status: progress, debug, blua32, layout: romLayout, outputDirectory });
}
