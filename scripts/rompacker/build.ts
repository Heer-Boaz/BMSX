import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RomArtifactStore, romBuildKey, type PreparedRomArtifact } from './artifacts';
import { romToolchainIdentity } from './build_state';
import type { RomArtifact, RomBuildUnit, RomBuildRecipe } from '../../toolchain/ts/rompack/build_manifest';
import { biosResPath, biosSourcePath, prepareRomInputs, testlibLuaPath, type RomBuildInputs } from './build_inputs';
import { CART_LIBRARY_ROOT } from '../../toolchain/ts/lua/source_paths';
import { collectCartSourceFiles } from './cart_source_files';
import { collectScenarioTestSourceFiles } from './scenario_test_sources';
import { SYSTEM_ROM_NAME } from '../../toolchain/ts/rompack/system';
import { BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { LuaError } from '../../toolchain/ts/lua/errors';
import { SCENARIO_TEST_SOURCE_SUFFIX } from '../../toolchain/ts/rompack/scenario_test';

export type MediaBuildOptions = { debug: boolean; optLevel: 0 | 1 | 2 | 3; force: boolean; respath?: string }
	& ({ domain: 'system' } | { domain: 'cart'; target: string });
export type BuildProgress = (phase: string) => void;
export type PreparedUnit = {
	inputs: RomBuildInputs; recipe: RomBuildRecipe; sourceFiles: string[];
	librarySourceFiles: string[]; testLibraryFiles: string[]; allLibraryFiles: string[]; scenarioSourceFiles: string[];
};

/** Capture both domains before compiling either. The cart links to this build's system, never dist sidecars. */
export async function prepareMediaBuild(options: MediaBuildOptions, store: RomArtifactStore, stage: string, progress: BuildProgress): Promise<PreparedRomArtifact> {
	progress('Capture inputs');
	const systemDirectory = join(stage, 'system');
	const toolchain = romToolchainIdentity();
	const target = options.domain === 'cart' ? options.target : 'system';
	const systemResources = options.domain === 'system' && options.respath !== undefined ? options.respath : biosResPath;
	const systemSources = collectCartSourceFiles([biosSourcePath]);
	const system: PreparedUnit = { inputs: await prepareRomInputs([systemResources], systemSources),
		recipe: { domain: 'system', debug: options.debug, optLevel: options.optLevel, projectRoot: join(systemResources, '..'), toolchain },
		sourceFiles: systemSources, librarySourceFiles: [], testLibraryFiles: [], allLibraryFiles: [], scenarioSourceFiles: [] };
	let cart: PreparedUnit | undefined;
	if (options.domain === 'cart') {
		const respath = options.respath ?? join('carts', target, 'res'), projectRoot = join(respath, '..');
		const sourceFiles = collectCartSourceFiles([projectRoot]).filter(path => !path.endsWith(SCENARIO_TEST_SOURCE_SUFFIX));
		const librarySourceFiles = collectCartSourceFiles([CART_LIBRARY_ROOT]);
		const testLibraryFiles = options.debug ? collectCartSourceFiles([testlibLuaPath]) : [];
		const testModuleFiles = options.debug ? collectCartSourceFiles([join('tests', projectRoot)]) : [];
		const scenarioSourceFiles = options.debug ? collectScenarioTestSourceFiles(projectRoot) : [];
		const allLibraryFiles = [...librarySourceFiles, ...testLibraryFiles, ...testModuleFiles];
		cart = { inputs: await prepareRomInputs([respath], [...sourceFiles, ...allLibraryFiles, ...scenarioSourceFiles]),
			recipe: { domain: 'cart', debug: options.debug, optLevel: options.optLevel, projectRoot, toolchain },
			sourceFiles, librarySourceFiles, testLibraryFiles, allLibraryFiles, scenarioSourceFiles };
	}
	const systemKey = romBuildKey({ name: SYSTEM_ROM_NAME, recipe: system.recipe, inputs: system.inputs.identity });
	const cachedSystem = options.force ? undefined : await store.find(systemKey);
	if (cart === undefined && cachedSystem !== undefined && cachedSystem.cart === undefined) {
		progress('Unchanged inputs and recipe'); return { artifact: cachedSystem, reused: true };
	}
	let systemUnit: RomBuildUnit;
	if (cachedSystem !== undefined) systemUnit = cachedSystem.system;
	else {
		const { compileSystem } = await import('./compile');
		const outputs = await compileWithDiagnostics(system, () => compileSystem(system, systemDirectory, progress));
		systemUnit = { key: systemKey, name: SYSTEM_ROM_NAME, recipe: system.recipe, inputs: system.inputs.identity,
			outputs: outputs.map(output => ({ file: `system/${output.file}`, digest: output.digest })) };
	}
	// Link identity includes the selected system's actual output bytes, not just its intended recipe.
	const cartKey = cart === undefined ? undefined : romBuildKey({ name: target, recipe: cart.recipe,
		inputs: cart.inputs.identity, system: systemKey, systemOutputs: systemUnit.outputs });
	if (cart !== undefined && !options.force) {
		const cached = await store.find(cartKey!);
		if (cached !== undefined) { progress('Unchanged inputs and recipe'); return { artifact: cached, reused: true }; }
	}
	if (cachedSystem !== undefined) {
		await mkdir(systemDirectory, { recursive: true });
		for (const output of systemUnit.outputs) await copyFile(join(store.directory(cachedSystem.id), output.file), join(stage, output.file));
	}
	let cartUnit: RomBuildUnit | undefined;
	if (cart !== undefined) {
		const { compileCart } = await import('./compile');
		const imports = await readFile(join(systemDirectory, `${SYSTEM_ROM_NAME}${options.debug ? '.debug' : ''}.rom${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`));
		cartUnit = { key: cartKey!, name: target, recipe: cart.recipe, inputs: cart.inputs.identity,
			outputs: await compileWithDiagnostics(cart, () => compileCart(cart, stage, target, imports, progress)) };
	}
	const contents = { target, system: systemUnit, cart: cartUnit };
	const artifact: RomArtifact = { id: romBuildKey(contents), ...contents };
	return { artifact, reused: false };
}

async function compileWithDiagnostics<T>(unit: PreparedUnit, work: () => Promise<T>): Promise<T> {
	try { return await work(); }
	catch (error) {
		if (!(error instanceof LuaError)) throw error;
		const file = unit.inputs.files.get(resolve(error.path)) ?? unit.inputs.files.get(resolve(unit.recipe.projectRoot, error.path));
		if (file === undefined) throw error; // Generated module diagnostics have no filesystem source.
		// disable-next-line newline_normalization_pattern -- Diagnostic line numbers refer to captured source.
		const source = file.text.split(/\r\n|\r|\n/)[error.line - 1];
		throw new Error(`${file.path}:${error.line}:${error.column}: ${error.message}\n${source}\n${' '.repeat(Math.max(0, error.column - 1))}^`);
	}
}
