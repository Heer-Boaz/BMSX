import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import { BLUA32_BIOS_IMPORTS_IMAGE_ID, decodeBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import type { TraceStatementSelection } from '../../toolchain/ts/lua/compiler/trace_statement';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { buildRomAssetSymbolModuleSourceFromSymbols, collectRomAssetSymbols } from '../../toolchain/ts/rompack/asset_symbols';
import { GX_DISPLAY_PRESET_MODULE_PATH, GX_REGISTER_MODULE_PATH, ROM_ASSET_SYMBOL_MODULE_PATH } from '../../toolchain/ts/rompack/generated_modules';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';
import { buildRomBlua32Tail, finalizeRompack, generateRomAssets, getResMetaList, getResourcesList } from '../../scripts/rompacker/rombuilder';

/** Real source scan, library closure, compiler, linker and cartridge packager. */
export async function buildSourceCartridgeFixture(
	workspace: string,
	projectRootPath: string,
	systemRom: Uint8Array,
	modules: readonly { path: string; source: string }[],
	options: { traceStatements: TraceStatementSelection; preloadModules: readonly string[] },
): Promise<Uint8Array> {
	const root = join(workspace, projectRootPath);
	for (const module of modules) {
		const path = join(root, `${module.path}.lua`);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, module.source);
	}
	const metadata = await getResMetaList([], {
		domain: 'cart', extraLuaPaths: [root], virtualRoot: root,
		libraryLuaPaths: ['cartlib', 'testlib'], sourceOnlyLuaRootFiles: [],
		sourceOnlyLuaModuleRoots: [],
	});
	const assets = await generateRomAssets(await getResourcesList(metadata));
	const layout = layoutRomPrefix(assets, true, { hardware: [{ type: 'rom' }] });
	const systemIndex = await loadRomAssetList(systemRom, 'system');
	const imports = systemIndex.entries.find(entry => entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID)!;
	const blua32 = buildRomBlua32Tail(assets, {
		...options,
		domain: 'cart', includeSymbols: true, optLevel: 3, imageOffset: layout.nextOffset,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		biosImports: decodeBlua32BiosImports(systemRom.subarray(imports.start, imports.end)),
		generatedLuaModules: [
			{ path: ROM_ASSET_SYMBOL_MODULE_PATH, source: buildRomAssetSymbolModuleSourceFromSymbols(collectRomAssetSymbols(layout.entries, 'cart')) },
			{ path: GX_DISPLAY_PRESET_MODULE_PATH, source: GX_DISPLAY_PRESET_MODULE_SOURCE },
			{ path: GX_REGISTER_MODULE_PATH, source: GX_REGISTER_MODULE_SOURCE },
		],
	});
	await finalizeRompack('fixture', { projectRootPath, debug: true, layout, blua32, outputDirectory: workspace });
	return new Uint8Array(await readFile(join(workspace, 'fixture.debug.rom')));
}
