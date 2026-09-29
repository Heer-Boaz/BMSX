// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE BUILDER CANNOT HANDLE THIS!!!!!

import pc from 'picocolors';

import {
	BIOS_FUNCTION_EXPORTS,
	SYSTEM_ROM_ASSET_OFFSET,
	SYSTEM_ROM_NAME,
} from '../../toolchain/ts/rompack/system';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { findExistingDirectory, getParamOrEnv, normalizePathKey, parseArgsVector } from '../lib/cli_arguments';
import { createCliUi } from '../lib/cli_ui';
import { compileAudioEventResources } from './audioeventcompiler';
import type { CartRomBlua32Tail } from './rombuilder';
import { collectCartSourceFiles } from './cart_source_files';
import type { TaskProgressReporter as ProgressReporter } from '../lib/task_progress';
import type { RomPackerOptions } from './rompacker.rompack';
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
import { LuaError } from '../../toolchain/ts/lua/errors';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX,
	decodeBlua32BiosImports,
} from '../../toolchain/ts/rompack/blua32_bios_imports';
import { buildScenarioTestSourceAssets, collectScenarioTestSourceFiles } from './scenario_test_sources';
import { biosResPath, biosSourcePath, cartlibLuaPath, getRomManifest, prepareRomInputs, testlibLuaPath, type RomBuildInputs } from './build_inputs';
import { recordRomBuild, romBuildStatus, romToolchainIdentity, type RomBuildRecipe } from './build_state';

import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

type ParsedOptions = RomPackerOptions;
const ui = createCliUi({ bannerTitle: 'BMSX BUILDER', labelWidth: 14 });
const writeOut = ui.writeOut;
const printBanner = ui.printBanner;
const logInfo = ui.info;
// @ts-ignore
const logWarn = ui.warn;
const logOk = ui.ok;
const logBullet = ui.bullet;
const logDivider = ui.divider;

const KNOWN_FLAGS = new Set<string>([
	'-romname',
	'-title',
	'-respath',
	'--output-dir',
	'--debug',
	'--force',
	'--skiptypecheck',
	'--mode',
	'-h',
	'--help',
]);

const FLAGS_WITH_VALUES = new Set<string>([
	'-romname',
	'-title',
	'-respath',
	'--output-dir',
]);
const OPT_LEVEL_RE = /^-O([0-3])$/;

const TASK = {
	REBUILD_CHECK: 'Checken of rebuild nodig is',
	MANIFEST_SCAN: 'Rom manifest zoekeren en parseren',
	CART_LUA_LINT: 'Cart Lua linten',
	RESOURCE_LIST: 'Resources scannen',
	RESOURCE_LOAD: 'Resources laden en metadata genereren',
	TEXTURE_BUILD: 'GX textures bouwen',
	ROM_ASSETS: 'Rom-assets genereren',
	ROM_FINALIZE: 'Rompakket finaliseren',
	BIOS_REBUILD_CHECK: 'Checken of BIOS rebuild nodig is',
	BIOS_LINT: 'BIOS Lua linten',
	BIOS_FINALIZE: 'BIOS ROM finaliseren',
	DONE: 'ROM PACKING GE-DONUT!! :-)',
} as const;

type TaskName = typeof TASK[keyof typeof TASK];

const taskList: TaskName[] = [
	TASK.REBUILD_CHECK,
	TASK.MANIFEST_SCAN,
	TASK.RESOURCE_LIST,
	TASK.RESOURCE_LOAD,
	TASK.TEXTURE_BUILD,
	TASK.ROM_ASSETS,
	TASK.CART_LUA_LINT,
	TASK.ROM_FINALIZE,
	TASK.DONE,
];

// --- Individual lists that allow us to easily remove tasks from the main task list (visualisation only!) ---
const romBuildTasks: TaskName[] = taskList.slice(1, -1);

const biosBuildTasks: TaskName[] = [
	TASK.BIOS_REBUILD_CHECK,
	TASK.BIOS_LINT,
	TASK.MANIFEST_SCAN,
	TASK.RESOURCE_LIST,
	TASK.TEXTURE_BUILD,
	TASK.ROM_ASSETS,
	TASK.BIOS_FINALIZE,
	TASK.DONE,
];
const biosPipelineTasks: TaskName[] = biosBuildTasks.slice(1, -1);
// const webTasks: TaskName[] = [
// 	'Platform-artifacts bouwen',
// ];


function getOptionalParam(args: string[], flag: string, envVar: string): string {
	const value = getParamOrEnv(args, flag, envVar, '', KNOWN_FLAGS);
	return value.length > 0 ? value : undefined;
}

function parseOptLevel(args: string[]): 0 | 1 | 2 | 3 {
	let optLevel: 0 | 1 | 2 | 3 = 3;
	for (const arg of args) {
		const match = arg.match(OPT_LEVEL_RE);
		if (!match) continue;
		optLevel = Number.parseInt(match[1], 10) as 0 | 1 | 2 | 3;
	}
	return optLevel;
}

function normalizeCartFolderName(input: string): string {
	const normalized = input.replace(/^[./\\]+/, '').replace(/\\/g, '/');
	if (normalized.startsWith('carts/')) {
		return normalized.slice('carts/'.length);
	}
	return normalized;
}

function resolveCartRoot(romName: string): string {
	const normalizedRomName = normalizeCartFolderName(romName);
	const romSegments = normalizedRomName.split('/').filter(Boolean);
	const romLeaf = romSegments.length > 0 ? romSegments[romSegments.length - 1] : normalizedRomName;
	const cartCandidates = [
		normalizedRomName ? `./carts/${normalizedRomName}` : undefined,
		romLeaf && romLeaf !== normalizedRomName ? `./carts/${romLeaf}` : undefined,
	];
	const cartRoot = findExistingDirectory(cartCandidates);
	if (!cartRoot) {
		const attempted = cartCandidates.filter(Boolean).map(normalizePathKey).join(', ');
		throw new Error(`Cart folder "${romName}" not found under carts. Tried: ${attempted || '<none>'}.`);
	}
	return normalizePathKey(cartRoot);
}

function resolveCartResPath(romName: string, respathOverride?: string): { cartRoot: string; respath: string } {
	if (respathOverride) {
		const resolvedResPath = findExistingDirectory([respathOverride]);
		if (!resolvedResPath) {
			throw new Error(`Resource path "${respathOverride}" does not exist.`);
		}
		const respath = normalizePathKey(resolvedResPath);
		return {
			cartRoot: normalizePathKey(join(respath, '..')),
			respath,
		};
	}
	const cartRoot = resolveCartRoot(romName);
	const respath = normalizePathKey(join(cartRoot, 'res'));
	if (!existsSync(respath)) {
		throw new Error(`Cart "${romName}" is missing its resource directory at ${respath}.`);
	}
	return { cartRoot, respath };
}

function parseOptions(args: string[]): ParsedOptions {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag) && !OPT_LEVEL_RE.test(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		writeOut(`Usage: <command> [options]\n`, 'warning');
		writeOut(`Options:\n`, 'warning');
		writeOut(`  -romname <name>          Cart folder under carts (required for rompack mode)\n`, 'warning');
		writeOut(`  -title <title>           Title override\n`, 'warning');
		writeOut(`  -respath <path>          Resource path override\n`, 'warning');
		writeOut(`  --output-dir <path>      ROM output directory (default: ./dist)\n`, 'warning');
		writeOut(`  --debug                  Build debug artifacts\n`, 'warning');
		writeOut(`  --force                  Force the compilation and build of the rompack\n`, 'warning');
		writeOut(`  --mode <rompack|bios>  What to build (default: rompack)\n`, 'warning');
		writeOut(`  -O0|-O1|-O2|-O3          Bytecode optimizer level (default: -O3)\n`, 'warning');
		process.exit(0);
	}

	const optLevel = parseOptLevel(args);

	const force = seenFlags.has('--force');
	const debug = seenFlags.has('--debug');
	const skipTypecheck = seenFlags.has('--skiptypecheck');

	const modeRaw = getParamOrEnv(args, '--mode', 'ROM_MODE', 'rompack', KNOWN_FLAGS);
	const modeStr = modeRaw.toLowerCase();
	let mode: 'rompack' | 'bios';
	if (modeStr === 'rompack') {
		mode = 'rompack';
	} else if (modeStr === 'bios') {
		mode = 'bios';
	} else {
		throw new Error(`Unsupported --mode "${modeRaw}". Expected one of: rompack, bios.`);
	}

	const rom_name = getParamOrEnv(args, '-romname', 'ROM_NAME', '', KNOWN_FLAGS);
	const title = getParamOrEnv(args, '-title', 'TITLE', rom_name, KNOWN_FLAGS);
	const respathOverride = getOptionalParam(args, '-respath', 'RES_PATH');
	const outputDirectory = normalizePathKey(getParamOrEnv(args, '--output-dir', 'ROM_OUTPUT_DIR', './dist', KNOWN_FLAGS));
	let respath = mode === 'bios' ? biosResPath : '';

	let extraLuaRoots: string[] = [];
	let libraryLuaRoots: string[] = [];
	if (mode === 'bios') {
		respath = getParamOrEnv(args, '-respath', 'RES_PATH', biosResPath, KNOWN_FLAGS);
		respath = normalizePathKey(respath);
	} else {
		if (!rom_name && !respathOverride) {
			throw new Error('Rompack mode requires -romname <cart-folder> or -respath <cart-respath>.');
		}
		const resolvedCart = resolveCartResPath(rom_name, respathOverride);
		respath = resolvedCart.respath;
		extraLuaRoots = [resolvedCart.cartRoot];
		libraryLuaRoots = [normalizePathKey(cartlibLuaPath)];
	}

	return {
		rom_name,
		title,
		respath,
		outputDirectory,
		force,
		debug,
		skipTypecheck,
		optLevel,
		mode,
		shouldBundleCartCode: false,
		extraLuaRoots,
		libraryLuaRoots,
	};
}

function formatEsbuildErrors(err: any): string[] {
	const result: string[] = [];
	const errors = (err?.errors ?? []) as Array<{ text?: string; location?: { file?: string; line?: number; column?: number }; notes?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }> }>;
	for (const e of errors) {
		const loc = e.location;
		const locStr = loc?.file ? `${loc.file}${loc.line ? `:${loc.line}` : ''}${loc.column ? `:${loc.column}` : ''}` : '';
		const msg = e.text ?? 'esbuild error';
		result.push(locStr ? `${locStr}: ${msg}` : msg);
		if (e.notes) {
			for (const note of e.notes) {
				const nloc = note.location;
				const nlocStr = nloc?.file ? `${nloc.file}${nloc.line ? `:${nloc.line}` : ''}${nloc.column ? `:${nloc.column}` : ''}` : '';
				if (note.text) {
					result.push(nlocStr ? `  note: ${nlocStr}: ${note.text}` : `  note: ${note.text}`);
				}
			}
		}
	}
	return result;
}

function formatLuaBuildError(err: LuaError, inputs: RomBuildInputs | undefined, virtualRoots: readonly string[]): string[] {
	const candidates = [resolve(err.path), ...virtualRoots.map(root => resolve(root, err.path))];
	const file = candidates.map(path => inputs?.files.get(path)).find(file => file !== undefined);
	const lines = [`${file === undefined ? err.path : file.path}:${err.line}:${err.column}: ${err.message}`];
	// Synthetic compiler modules have no filesystem input. Never reread newer source for a diagnostic.
	if (file !== undefined) {
		// disable-next-line newline_normalization_pattern -- Lua diagnostics address lines in captured source.
		const sourceLine = file.text.split(/\r\n|\r|\n/)[err.line - 1];
		const gutter = `${err.line} | `;
		lines.push(`${gutter}${sourceLine}`, `${' '.repeat(gutter.length + Math.max(0, err.column - 1))}^`);
	}
	return lines;
}

async function runBIOSBuild(options: ParsedOptions, inputs: RomBuildInputs, sourceFiles: readonly string[], progress?: ProgressReporter): Promise<void> {
	const { respath, outputDirectory, force, debug, optLevel } = options;

	const BIOSResPath = respath || biosResPath;
	if (!BIOSResPath) {
		throw new Error(`Missing BIOS respath (expected ${biosResPath}).`);
	}
	const BIOSRomName = SYSTEM_ROM_NAME;
	const BIOSRomPath = join(outputDirectory, `${BIOSRomName}${debug ? '.debug' : ''}.rom`);

	const BIOSProjectRoot = normalizePathKey(join(BIOSResPath, '..'));
	const BIOSVirtualRoot = BIOSProjectRoot.replace(/^\.\//, '');

	logDivider('bios');
	logBullet('ROM', pc.bold(pc.white(BIOSRomName)));
	logBullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));
	logBullet('Opt level', pc.white(`-O${optLevel}`));
	if (progress) {
		progress.showInitial();
	}

	const recipe: RomBuildRecipe = { domain: 'system', debug, optLevel, projectRoot: BIOSVirtualRoot, toolchain: romToolchainIdentity() };
	const buildStatus = force ? 'forced' : await romBuildStatus(BIOSRomPath, recipe, inputs.identity);
	logBullet('Build reason', buildStatus);
	const assetsNeedRebuild = buildStatus !== 'up-to-date';
	if (progress) await progress.taskCompleted();
	if (!assetsNeedRebuild) {
		logInfo('BIOS assets up-to-date (use --force to rebuild)');
		if (progress) {
			progress.skipTasks(biosPipelineTasks.length);
			await progress.showDone();
		}
		return;
	}
	const { buildRomBlua32Tail, createTextureAtlases, finalizeRompack, generateRomAssets,
		getResMetaList, getResourcesList } = await import('./rombuilder');
	const { lintCartSources } = await import('./cart_lua_linter_runtime');

	const runBIOSStep = async <T>(task: string, action: () => Promise<T>): Promise<T> => {
		const result = progress ? await progress.runWithDetail(task, action) : await action();
		if (progress) {
			await progress.taskCompleted();
		}
		return result;
	};
	await runBIOSStep(TASK.BIOS_LINT, () => lintCartSources({
		sources: sourceFiles.map(file => inputs.files.get(resolve(file))!),
		profile: 'bios',
	}));

	const BIOSResMetaList = await runBIOSStep(TASK.MANIFEST_SCAN, () => getResMetaList(inputs, {
		domain: 'system',
		sourceOnlyLuaRootFiles: [],
		sourceOnlyLuaModuleRoots: [],
		extraLuaFiles: sourceFiles,
		virtualRoot: BIOSVirtualRoot,
	}));
	const BIOSResources = await runBIOSStep(TASK.RESOURCE_LIST, () => getResourcesList(BIOSResMetaList));
	await runBIOSStep(TASK.TEXTURE_BUILD, () => createTextureAtlases(BIOSResources));
	compileAudioEventResources(BIOSResources);
	const BIOSRomAssets = await runBIOSStep(TASK.ROM_ASSETS, () => generateRomAssets(BIOSResources, message => progress?.setDetail(message)));
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
	await runBIOSStep(TASK.BIOS_FINALIZE, async () => {
		const outputs = await finalizeRompack(BIOSRomName, {
			projectRootPath: BIOSVirtualRoot, debug, blua32: BIOSBlua32, layout: BIOSLayout, outputDirectory,
		});
		await recordRomBuild(BIOSRomPath, { recipe, inputs: inputs.identity, outputs });
	});
	if (progress) {
		await progress.showDone();
	}
	logOk(`BIOS assets ready → ${pc.white(BIOSRomPath)}`);
}

async function main() {
	let progress: ProgressReporter | undefined;
	let romOutputPath = '';
	let luaErrorVirtualRoots: string[] = [];
	let inputs: RomBuildInputs | undefined;
	const bufferedLogs: string[] = [];
	try {
		printBanner();

		const args = process.argv.slice(2);
		const options = parseOptions(args);

		let { title, rom_name, respath, outputDirectory, force, debug, optLevel, mode, extraLuaRoots, libraryLuaRoots } = options;

		if (mode === 'bios') {
			progress = ui.createProgress(biosBuildTasks);
			const sourceFiles = collectCartSourceFiles([biosSourcePath]);
			inputs = await prepareRomInputs([respath], sourceFiles);
			luaErrorVirtualRoots = [join(respath, '..')];
			await runBIOSBuild(options, inputs, sourceFiles, progress);
			writeOut('\n');
			return;
		}

		progress = ui.createProgress(taskList);
		const romPackDebug = debug;
		const projectRootPath = normalizePathKey(join(respath, '..')).replace(/^\.\//, '');
		const virtualRoot = projectRootPath;
		luaErrorVirtualRoots = [virtualRoot];

		const cartSourceFiles = collectCartSourceFiles(extraLuaRoots);
		const librarySourceFiles = collectCartSourceFiles(libraryLuaRoots);
		const testLibraryFiles = debug ? collectCartSourceFiles([testlibLuaPath]) : [];
		const testModuleFiles = debug ? collectCartSourceFiles([join('tests', projectRootPath)]) : [];
		const allLibraryFiles = [...librarySourceFiles, ...testLibraryFiles, ...testModuleFiles];
		const scenarioSourceFiles = debug ? collectScenarioTestSourceFiles(projectRootPath) : [];
		const cartHasProgramSource = cartSourceFiles.length !== 0;
		const biosImportsPath = cartHasProgramSource
			? join(outputDirectory, `${SYSTEM_ROM_NAME}${debug ? '.debug' : ''}.rom${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`)
			: undefined;
		if (biosImportsPath !== undefined && !existsSync(biosImportsPath)) {
			throw new Error(`BIOS import library not found at "${biosImportsPath}". Build the BIOS ROM first.`);
		}
		inputs = await prepareRomInputs([respath], [...cartSourceFiles, ...allLibraryFiles, ...scenarioSourceFiles,
			...(biosImportsPath === undefined ? [] : [biosImportsPath])]);

		if (!rom_name) {
			throw new Error('Missing required argument: --romname or ROM_NAME environment variable.');
		}

		if (rom_name.includes('.')) {
			throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'pietious'.`);
		}
		rom_name = rom_name.toLowerCase();

		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		const romManifest = getRomManifest(inputs);
		if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
		title = romManifest.title ?? title;
		romOutputPath = join(outputDirectory, `${rom_name}${romPackDebug ? '.debug' : ''}.rom`);

		logDivider('Run setup');
		logBullet('ROM', pc.bold(pc.white(rom_name)));
		logBullet('Title', pc.white(title));
		logBullet('Mode', pc.magenta(mode));
		logBullet('Resources', pc.white(respath));

		logDivider('Options');
		logBullet('Rebuild', force ? pc.yellow('force') : pc.green('auto (recipe + input content)'));
		logBullet('GX textures', pc.green('enabled'));
		logBullet('Lua case', pc.green('lower-case identifiers required'));
		logBullet('Build', debug ? pc.cyan('DEBUG') : pc.blue('NON-DEBUG'));
		logBullet('Opt level', pc.white(`-O${optLevel}`));
		const recipe: RomBuildRecipe = { domain: 'cart', debug, optLevel, projectRoot: virtualRoot, toolchain: romToolchainIdentity() };
		logDivider('Pipeline');
		logInfo(`Starting for ${pc.bold(pc.blue(rom_name))}`);
		const buildStatus = force ? 'forced' : await progress.runWithDetail('Compare build inputs', () => romBuildStatus(romOutputPath, recipe, inputs.identity));
		logBullet('Build reason', buildStatus);
		const rebuildRequired = buildStatus !== 'up-to-date';
		if (!rebuildRequired) {
			logInfo('Rebuild skipped: recipe, captured inputs and output content are unchanged');
			progress.removeTasks(romBuildTasks);
		}

		progress.showInitial();

		await progress.taskCompleted();
		romOutputPath = join(outputDirectory, `${rom_name}${romPackDebug ? '.debug' : ''}.rom`);

		if (rebuildRequired) {
			const { TEST_EXECUTION_MODULE_PATH } = await import('../../toolchain/ts/rompack/test_cartridge');
			const { buildRomBlua32Tail, createTextureAtlases, finalizeRompack, generateRomAssets,
				getResMetaList, getResourcesList } = await import('./rombuilder');
			const { lintCartSources } = await import('./cart_lua_linter_runtime');
			const romResMetaList = await progress.runWithDetail('Scan resources', () => getResMetaList(inputs, {
				domain: 'cart',
				extraLuaFiles: cartSourceFiles,
				libraryLuaFiles: allLibraryFiles,
				sourceOnlyLuaRootFiles: scenarioSourceFiles,
				sourceOnlyLuaModuleRoots: scenarioSourceFiles.length === 0 ? [] : [TEST_EXECUTION_MODULE_PATH],
				virtualRoot,
			}));
			await progress.taskCompleted();
			// Build resources
			const resources = await progress.runWithDetail('Load resources', () => getResourcesList(romResMetaList));
			await progress.taskCompleted();

			await progress.runWithDetail('Generate GX textures', () => createTextureAtlases(
				resources,
				message => progress.setDetail(message),
			));
			await progress.taskCompleted();

			// Compile AEM resources against the loaded audio and data resources.
			compileAudioEventResources(resources);

			const romAssets = await progress.runWithDetail('Generate ROM assets', async () => {
				const assets = await generateRomAssets(resources, message => progress.setDetail(message));
				assets.push(...buildScenarioTestSourceAssets(scenarioSourceFiles.map(file => inputs.files.get(resolve(file))!)));
				return assets;
			});
			const romLayout = layoutRomPrefix(romAssets, romPackDebug, romManifest);
			let blua32: CartRomBlua32Tail | null = null;
			if (biosImportsPath !== undefined) {
				const biosImports = decodeBlua32BiosImports(inputs.files.get(resolve(biosImportsPath))!.bytes);
				const assetSymbols = collectRomAssetSymbols(romLayout.entries, 'cart');
				const assetSymbolModuleSource = buildRomAssetSymbolModuleSourceFromSymbols(assetSymbols);
				blua32 = buildRomBlua32Tail(romAssets, {
					includeSymbols: romPackDebug,
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
			await progress.taskCompleted();
			if (biosImportsPath !== undefined) {
				await progress.runWithDetail('Lint cart + shared Lua', async () => {
					await lintCartSources({ sources: cartSourceFiles.map(file => inputs.files.get(resolve(file))!), profile: 'cart' });
					await lintCartSources({ sources: [...librarySourceFiles, ...testLibraryFiles].map(file => inputs.files.get(resolve(file))!), profile: 'bios' });
				});
			}
			await progress.taskCompleted();

			await progress.runWithDetail('Finalize ROM pack', async () => {
				const outputs = await finalizeRompack(rom_name, {
					projectRootPath, status: message => progress.setDetail(message),
					debug: romPackDebug, blua32, layout: romLayout, outputDirectory,
				});
				await recordRomBuild(romOutputPath, { recipe, inputs: inputs.identity, outputs });
			});
			await progress.taskCompleted();
		}

		await progress.showDone();
		const romOutput = romOutputPath.length > 0 ? pc.white(romOutputPath) : pc.white(join(outputDirectory, '<rom>.rom'));
		logOk(`ROM packing complete → ${romOutput}`);
		writeOut(`\n`);
		} catch (e) {
			process.exitCode = 1;
			const message = e instanceof Error ? e.message : String(e);
			const isCompilationFailureReport = typeof message === 'string'
				&& /^Compilation failed with \d+ (?:Lua )?error\(s\):/.test(message);
			// disable-next-line newline_normalization_pattern -- rompacker failure output is presented one diagnostic line at a time.
			const detailLines = typeof message === 'string' ? message.split('\n') : [String(message)];
		if (progress) {
			progress.stop();
			await progress.pulse();
			const failedTask = progress.currentTask();
			const summary = e instanceof LuaError
				? `${e.path}:${e.line}:${e.column}: ${e.message}`
				: detailLines[0] ?? String(e);
			if (failedTask) {
				progress.fail(failedTask, summary);
				writeOut(`${pc.red(`✘ Failed during: ${failedTask}`)}`, 'error');
				if (!isCompilationFailureReport) {
					for (let lineIndex = 1; lineIndex < detailLines.length; lineIndex += 1) {
						const line = detailLines[lineIndex];
						if (line.length > 0) {
							writeOut(pc.red(line), 'error');
						}
					}
				}
			}
		}

		const prettyErrors: string[] = [];

		// Add buffered logs (e.g., TypeScript errors)
		prettyErrors.push(...bufferedLogs);

		// Add esbuild-specific errors if available
		const esErrors = formatEsbuildErrors(e);
		if (esErrors.length > 0) {
			prettyErrors.push(...esErrors);
		} else if (e instanceof LuaError) {
			prettyErrors.push(...formatLuaBuildError(e, inputs, luaErrorVirtualRoots));
		} else {
				// Only add main error message if no esbuild errors were extracted
				const mainMessage = (e as any)?.message as string;
				if (mainMessage && mainMessage.trim().length > 0) {
					// disable-next-line newline_normalization_pattern -- multi-line tool errors are flattened into rompacker diagnostic lines.
					const lines = mainMessage.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
				if (isCompilationFailureReport && lines.length > 0) {
					prettyErrors.push(...lines.slice(1));
				} else {
					prettyErrors.push(...lines);
				}
			}
		}

		// Deduplicate
		const uniqueErrors = Array.from(new Set(prettyErrors));

		if (uniqueErrors.length > 0) {
			writeOut(`\n${uniqueErrors.join('\n')}\n`);
		}
	}
}

main();
