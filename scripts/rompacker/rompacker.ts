// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE BUILDER CANNOT HANDLE THIS!!!!!

import pc from 'picocolors';

import {
	BIOS_FUNCTION_EXPORTS,
	SYSTEM_ROM_ASSET_OFFSET,
	SYSTEM_ROM_NAME,
} from '../../toolchain/ts/rompack/system';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { findExistingDirectory, getParamOrEnv, normalizePathKey, parseArgsVector } from '../tooling/cli_arguments';
import { createCliUi } from '../tooling/cli_ui';
import { compileAudioEventResources } from './audioeventcompiler';
import { lintCartSources } from './cart_lua_linter_runtime';
import { biosSourcePath, BLUA32_SYMBOLS_SIDECAR_SUFFIX, buildRomBlua32Tail, biosResPath, cartlibLuaPath, compileLuaChunkBuffer, createTextureAtlases, finalizeRompack, generateRomAssets, getResMetaList, getResourcesList, getRomManifest, isRebuildRequired } from './rombuilder';
import { buildPresentationConfigModuleSource, buildTextureBindingsModuleSource } from './gx_vram_layout';
import type { TaskProgressReporter as ProgressReporter } from '../tooling/task_progress';
import type { RomPackerOptions } from './rompacker.rompack';
import { buildRomAssetSymbolModuleSourceFromSymbols, collectRomAssetSymbols } from '../../toolchain/ts/rompack/asset_symbols';
import {
	PRESENTATION_CONFIG_MODULE_PATH,
	PRESENTATION_CONFIG_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
	TEXTURE_BINDINGS_MODULE_PATH,
	TEXTURE_BINDINGS_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import { resolveCartridgeHeaderWords } from '../../toolchain/ts/rompack/manifest';
import { LuaError } from '../../toolchain/ts/lua/errors';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX,
	decodeBlua32BiosImports,
} from '../../toolchain/ts/rompack/blua32_bios_imports';

import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';

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
const BIOS_BUILD_SOURCE_DIRECTORIES = [
	'./machine/ts/common',
	'./machine/ts/rompack',
	'./machine/ts/spec',
	'./scripts/lint',
	'./scripts/rompacker',
	'./scripts/tooling',
	'./toolchain/ts',
] as const;
const BIOS_BUILD_SOURCE_FILES = [
	'./package.json',
	'./package-lock.json',
	'./scripts/tsconfig.json',
	'./tsconfig.base.json',
	'./tsconfig.json',
] as const;

// const webTasks: TaskName[] = [
// 	'Platform-artifacts bouwen',
// ];

const rebuildCheckTasks: TaskName[] = [TASK.REBUILD_CHECK];

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

function resolveLuaSourcePath(candidate: string, virtualRoots: ReadonlyArray<string>): string {
	const normalized = normalizePathKey(candidate);
	if (existsSync(normalized)) {
		return normalized;
	}
	for (const root of virtualRoots) {
		const normalizedRoot = normalizePathKey(root);
		const joined = normalizePathKey(join(normalizedRoot, normalized));
		if (existsSync(joined)) {
			return joined;
		}
	}
	return normalized;
}

function formatLuaBuildError(err: LuaError, virtualRoots: ReadonlyArray<string>): string[] {
	const lines: string[] = [];
	const resolvedPath = resolveLuaSourcePath(err.path, virtualRoots);
	const location = `${resolvedPath}:${err.line}:${err.column}`;
	lines.push(`${location}: ${err.message}`);

	try {
		const source = readFileSync(resolvedPath, 'utf8');
		// disable-next-line newline_normalization_pattern -- Lua build diagnostics map file text to one logical source line.
		const sourceLines = source.split(/\r\n|\r|\n/);
		const sourceLine = sourceLines[err.line - 1];
		if (sourceLine === undefined) {
			return lines;
		}
		const gutter = `${err.line} | `;
		lines.push(`${gutter}${sourceLine}`);
		const caretOffset = Math.max(0, err.column - 1);
		lines.push(`${' '.repeat(gutter.length + caretOffset)}^`);
		return lines;
	} catch (readError) {
		const message = readError instanceof Error ? readError.message : String(readError);
		lines.push(`(unable to read ${resolvedPath}: ${message})`);
		return lines;
	}
}

async function runBIOSBuild(options: ParsedOptions, progress?: ProgressReporter): Promise<void> {
	const { respath, outputDirectory, force, debug, optLevel } = options;

	const BIOSResPath = respath || biosResPath;
	if (!BIOSResPath) {
		throw new Error(`Missing BIOS respath (expected ${biosResPath}).`);
	}
	const BIOSRomName = SYSTEM_ROM_NAME;
	const BIOSRomPath = join(outputDirectory, `${BIOSRomName}${debug ? '.debug' : ''}.rom`);
	const BIOSSymbolsPath = `${BIOSRomPath}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`;
	const BIOSImportsPath = `${BIOSRomPath}${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`;

	const BIOSProjectRoot = normalizePathKey(join(BIOSResPath, '..'));
	const BIOSVirtualRoot = BIOSProjectRoot.replace(/^\.\//, '');

	logDivider('bios');
	logBullet('ROM', pc.bold(pc.white(BIOSRomName)));
	logBullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));
	logBullet('Opt level', pc.white(`-O${optLevel}`));
	if (progress) {
		progress.showInitial();
	}

	let assetsNeedRebuild = false;
	if (force) {
		assetsNeedRebuild = true;
		if (progress) {
			await progress.taskCompleted();
		}
	} else {
		const checkBuild = async () => {
			if (!existsSync(BIOSRomPath)
				|| !existsSync(BIOSSymbolsPath)
				|| !existsSync(BIOSImportsPath)) {
				return true;
			}
			const romMtimeMs = statSync(BIOSRomPath).mtimeMs;
			if (statSync(BIOSSymbolsPath).mtimeMs > romMtimeMs
				|| statSync(BIOSImportsPath).mtimeMs > romMtimeMs) {
				return true;
			}
			return isRebuildRequired(BIOSRomName, BIOSResPath, {
				extraLuaPaths: [biosSourcePath],
				buildSourceDirectories: BIOS_BUILD_SOURCE_DIRECTORIES,
				buildSourceFiles: BIOS_BUILD_SOURCE_FILES,
				debug,
				romFilePath: BIOSRomPath,
			});
		};
		assetsNeedRebuild = progress ? await progress.runWithDetail(TASK.BIOS_REBUILD_CHECK, checkBuild) : await checkBuild();
		if (progress) {
			await progress.taskCompleted();
		}
	}
	if (!assetsNeedRebuild) {
		logInfo('BIOS assets up-to-date (use --force to rebuild)');
		if (progress) {
			progress.skipTasks(biosPipelineTasks.length);
			await progress.showDone();
		}
		return;
	}

	const runBIOSStep = async <T>(task: string, action: () => Promise<T>): Promise<T> => {
		const result = progress ? await progress.runWithDetail(task, action) : await action();
		if (progress) {
			await progress.taskCompleted();
		}
		return result;
	};
	await runBIOSStep(TASK.BIOS_LINT, () => lintCartSources({
		roots: [normalizePathKey(biosSourcePath)],
		profile: 'bios',
	}));

	const BIOSResMetaList = await runBIOSStep(TASK.MANIFEST_SCAN, () => getResMetaList([BIOSResPath], BIOSRomName, {
		extraLuaPaths: [biosSourcePath],
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
		generatedLuaModules: [{
			path: SYSTEM_ASSET_SYMBOL_MODULE_PATH,
			source: BIOSAssetSymbolModuleSource,
		}],
		includeSymbols: debug,
		optLevel,
		systemAssetEndOffset: BIOSLayout.nextOffset,
		biosExports: BIOS_FUNCTION_EXPORTS,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		domain: 'system',
	});
	await runBIOSStep(TASK.BIOS_FINALIZE, () => finalizeRompack(BIOSRomName, {
		projectRootPath: '',
		debug,
		blua32: BIOSBlua32,
		layout: BIOSLayout,
		outputDirectory,
		cartridgeBoardWord: 0,
		cartridgeRamByteCount: 0,
	}));
	if (progress) {
		await progress.showDone();
	}
	logOk(`BIOS assets ready → ${pc.white(BIOSRomPath)}`);
}

async function main() {
	let progress: ProgressReporter | undefined;
	let romOutputPath = '';
	let luaErrorVirtualRoots: string[] = [];
	const bufferedLogs: string[] = [];
	try {
		printBanner();

		const args = process.argv.slice(2);
		const options = parseOptions(args);

		let { title, rom_name, respath, outputDirectory, force, debug, optLevel, mode, extraLuaRoots, libraryLuaRoots } = options;

		if (mode === 'bios') {
			progress = ui.createProgress(biosBuildTasks);
			await runBIOSBuild(options, progress);
			writeOut('\n');
			return;
		}

		progress = ui.createProgress(taskList);
		const romPackDebug = debug;
		const projectRootPath = normalizePathKey(join(respath, '..')).replace(/^\.\//, '');
		const virtualRoot = projectRootPath;
		luaErrorVirtualRoots = [virtualRoot];

		const resourceRoots = [respath || biosResPath, biosResPath];
		const extraLuaPathSet = new Set<string>(extraLuaRoots.map(normalizePathKey));
		const libraryLuaPathSet = new Set<string>(libraryLuaRoots.map(normalizePathKey));

		if (!rom_name) {
			throw new Error('Missing required argument: --romname or ROM_NAME environment variable.');
		}

		if (rom_name.includes('.')) {
			throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'pietious'.`);
		}
		rom_name = rom_name.toLowerCase();

		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		const romManifest = await getRomManifest(respath);
		if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
		const { gx_vram_layout, ...runtimeRomManifest } = romManifest;
		title = romManifest.title ?? title;
		romOutputPath = join(outputDirectory, `${rom_name}${romPackDebug ? '.debug' : ''}.rom`);

		logDivider('Run setup');
		logBullet('ROM', pc.bold(pc.white(rom_name)));
		logBullet('Title', pc.white(title));
		logBullet('Mode', pc.magenta(mode));
		logBullet('Resources', `${pc.white(resourceRoots[0])} ${pc.dim('+ common ' + resourceRoots[1])}`);

		logDivider('Options');
		logBullet('Rebuild', force ? pc.yellow('force') : pc.green('auto (mtime check)'));
		logBullet('GX textures', pc.green('enabled'));
		logBullet('Lua case', pc.green('lower-case identifiers required'));
		logBullet('Build', debug ? pc.cyan('DEBUG') : pc.blue('NON-DEBUG'));
		logBullet('Opt level', pc.white(`-O${optLevel}`));
		const biosImportsPath = join(
			outputDirectory,
			`${SYSTEM_ROM_NAME}${romPackDebug ? '.debug' : ''}.rom${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`,
		);
		if (!existsSync(biosImportsPath)) {
			throw new Error(`BIOS import library not found at "${biosImportsPath}". Build the BIOS ROM first.`);
		}

		let rebuildRequired = true;
		if (force) {
			progress.removeTasks(rebuildCheckTasks);
		}
		else {
			logInfo('Rebuild only if inputs are newer than outputs');
		}
		logDivider('Pipeline');
		logInfo(`Starting for ${pc.bold(pc.blue(`${rom_name}`))}`);

		if (!force) {
			rebuildRequired = await progress.runWithDetail('Check timestamps', () => isRebuildRequired(rom_name, respath, {
				extraLuaPaths: [...extraLuaPathSet, ...libraryLuaPathSet],
				debug,
				romFilePath: romOutputPath,
				biosImportsFilePath: biosImportsPath,
			}));
			if (!rebuildRequired) {
				for (let i = 1; i < resourceRoots.length; i++) {
					const candidate = resourceRoots[i];
					if (!candidate || candidate === respath) continue;
					const needs = await progress.runWithDetail('Check timestamps (shared)', () => isRebuildRequired(rom_name, candidate, {
						extraLuaPaths: [...extraLuaPathSet, ...libraryLuaPathSet],
						debug,
						romFilePath: romOutputPath,
						biosImportsFilePath: biosImportsPath,
					}));
					rebuildRequired = rebuildRequired || needs;
					if (rebuildRequired) break;
				}
			}
			if (!rebuildRequired) {
				logInfo('Rebuild skipped: cart rom is newer than sources/assets (use --force to override)');
			}
			progress.skipTasks(rebuildCheckTasks.length);
		} else rebuildRequired = true;
		if (!rebuildRequired) {
			progress.removeTasks(romBuildTasks);
		}
		progress.showInitial();

		await progress.taskCompleted();
		romOutputPath = join(outputDirectory, `${rom_name}${romPackDebug ? '.debug' : ''}.rom`);

		if (rebuildRequired) {
			const romResMetaList = await progress.runWithDetail('Scan resources', () => getResMetaList(resourceRoots, rom_name, {
				extraLuaPaths: Array.from(extraLuaPathSet),
				libraryLuaPaths: Array.from(libraryLuaPathSet),
				virtualRoot,
			}));
			await progress.taskCompleted();
			// Build resources
			let resources = await progress.runWithDetail('Load resources', () => getResourcesList(romResMetaList));
			await progress.taskCompleted();

			await progress.runWithDetail('Generate GX textures', () => createTextureAtlases(
				resources,
				gx_vram_layout,
				message => progress.setDetail(message),
			));
			await progress.taskCompleted();

			// Compile AEM resources against the loaded audio and data resources.
			compileAudioEventResources(resources);

			const romAssets = await progress.runWithDetail('Generate ROM assets', () => generateRomAssets(resources, message => progress.setDetail(message)));
			if (gx_vram_layout) {
				const source = buildTextureBindingsModuleSource(gx_vram_layout);
				romAssets.push({
					resid: TEXTURE_BINDINGS_MODULE_PATH,
					type: 'lua',
					buffer: Buffer.from(source),
					compiled_buffer: compileLuaChunkBuffer(source, TEXTURE_BINDINGS_MODULE_PATH),
					source_path: TEXTURE_BINDINGS_SOURCE_PATH,
					update_timestamp: 0,
				});
				if (gx_vram_layout.framebuffers.length > 0) {
					const presentationConfigSource = buildPresentationConfigModuleSource(gx_vram_layout);
					romAssets.push({
						resid: PRESENTATION_CONFIG_MODULE_PATH,
						type: 'lua',
						buffer: Buffer.from(presentationConfigSource),
						compiled_buffer: compileLuaChunkBuffer(presentationConfigSource, PRESENTATION_CONFIG_MODULE_PATH),
						source_path: PRESENTATION_CONFIG_SOURCE_PATH,
						update_timestamp: 0,
					});
				}
			}
			const biosImports = decodeBlua32BiosImports(readFileSync(biosImportsPath));
			const romLayout = layoutRomPrefix(romAssets, romPackDebug, runtimeRomManifest);
			const assetSymbols = collectRomAssetSymbols(romLayout.entries, 'cart');
			const assetSymbolModuleSource = buildRomAssetSymbolModuleSourceFromSymbols(assetSymbols);
			const blua32 = buildRomBlua32Tail(romAssets, {
				includeSymbols: romPackDebug,
				optLevel,
				imageOffset: romLayout.nextOffset,
				ramByteCount: PSX_MACHINE_SPEC.ramBytes,
				domain: 'cart',
				biosImports,
				generatedLuaModules: [{ path: ROM_ASSET_SYMBOL_MODULE_PATH, source: assetSymbolModuleSource }],
			});
			const cartridgeHeaderWords = resolveCartridgeHeaderWords(romManifest);
			await progress.taskCompleted();
			const cartLuaRoots = Array.from(extraLuaPathSet);
			const cartlibLuaRoots = Array.from(libraryLuaPathSet);
			await progress.runWithDetail('Lint cart + cartlib Lua', async () => {
				await lintCartSources({ roots: cartLuaRoots, profile: 'cart' });
				await lintCartSources({ roots: cartlibLuaRoots, profile: 'bios' });
			});
			await progress.taskCompleted();

			await progress.runWithDetail('Finalize ROM pack', () => finalizeRompack(rom_name, {
				projectRootPath,
				status: message => progress.setDetail(message),
				debug: romPackDebug,
				blua32,
				layout: romLayout,
				outputDirectory,
				cartridgeBoardWord: cartridgeHeaderWords.cartridgeBoardWord,
				cartridgeRamByteCount: cartridgeHeaderWords.cartridgeRamByteCount,
			}));
			await progress.taskCompleted();
		}

		await progress.showDone();
		const romOutput = romOutputPath.length > 0 ? pc.white(romOutputPath) : pc.white(join(outputDirectory, '<rom>.rom'));
		logOk(`ROM packing complete → ${romOutput}`);
		writeOut(`\n`);
		} catch (e) {
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
				? `${resolveLuaSourcePath(e.path, luaErrorVirtualRoots)}:${e.line}:${e.column}: ${e.message}`
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
			prettyErrors.push(...formatLuaBuildError(e, luaErrorVirtualRoots));
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
