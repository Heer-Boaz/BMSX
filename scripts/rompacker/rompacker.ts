// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE BUILDER CANNOT HANDLE THIS!!!!!

import pc from 'picocolors';

import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_ROM_NAME } from '../../machine/ts/core/system';
import { findExistingDirectory, getParamOrEnv, normalizePathKey, parseArgsVector } from './cli';
import { createCliUi } from './display';
import { validateAudioEventReferences } from './audioeventvalidator';
import { lintCartSources } from './cart_lua_linter_runtime';
import { appendProgramImage, biosLuaPath, buildLuaProgramContextAssets, commonResPath, cartlibLuaPath, systemLuaPath, compileLuaChunkBuffer, createTextureAtlases, finalizeRompack, generateRomAssets, getResMetaList, getResourcesList, getRomManifest, isRebuildRequired } from './rombuilder';
import { buildGxTextureLayoutModuleSource } from './gx_texture_layout';
import type { TaskProgressReporter as ProgressReporter } from './progress';
import type { RomPackerOptions } from './rompacker.rompack';
import type { RomAsset } from '../../machine/ts/rompack/format';
import { buildRomAssetSymbolModuleSourceFromSymbols, collectRomAssetSymbols } from '../../machine/ts/rompack/asset_symbols';
import {
	GX_TEXTURE_LAYOUT_MODULE_PATH,
	GX_TEXTURE_LAYOUT_SOURCE_PATH,
	ROM_ASSET_SYMBOL_MODULE_PATH,
} from '../../machine/ts/rompack/format';
import { LuaError } from '../../machine/ts/lua/errors';

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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
	'-bootloaderpath',
	'-respath',
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
	'-bootloaderpath',
	'-respath',
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

function stripLuaAssets(assets: RomAsset[], debug: boolean): void {
	if (debug) {
		return;
	}
	for (let index = assets.length - 1; index >= 0; index -= 1) {
		if (assets[index].type === 'lua') {
			assets.splice(index, 1);
		}
	}
}

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
		writeOut(`  -bootloaderpath <path>   BIOS-only bootloader path override\n`, 'warning');
		writeOut(`  -respath <path>          Resource path override\n`, 'warning');
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
	const defaultBootloaderPath = './machine/firmware/default_cart';
	let bootloader_path = getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', defaultBootloaderPath, KNOWN_FLAGS);
	const respathOverride = getOptionalParam(args, '-respath', 'RES_PATH');
	let respath = mode === 'bios' ? './machine/firmware/res' : '';

	let extraLuaRoots: string[] = [];
	let libraryLuaRoots: string[] = [];
	if (mode === 'bios') {
		respath = getParamOrEnv(args, '-respath', 'RES_PATH', './machine/firmware/res', KNOWN_FLAGS);
		bootloader_path = normalizePathKey(bootloader_path);
		respath = normalizePathKey(respath);
	} else {
		if (!rom_name && !respathOverride) {
			throw new Error('Rompack mode requires -romname <cart-folder> or -respath <cart-respath>.');
		}
		if (seenFlags.has('-bootloaderpath')) {
			throw new Error('Rompack mode no longer supports -bootloaderpath. Carts always boot through machine/firmware/default_cart.');
		}
		const resolvedCart = resolveCartResPath(rom_name, respathOverride);
		bootloader_path = normalizePathKey(defaultBootloaderPath);
		respath = resolvedCart.respath;
		extraLuaRoots = [resolvedCart.cartRoot];
		libraryLuaRoots = [normalizePathKey(cartlibLuaPath)];
	}

	return {
		rom_name,
		title,
		bootloader_path,
		respath,
		force,
		debug,
		skipTypecheck,
		platform: 'browser',
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
	const { respath, bootloader_path, force, debug, optLevel } = options;

	const BIOSResPath = respath || commonResPath;
	if (!BIOSResPath) {
		throw new Error('Missing BIOS respath (expected ./machine/firmware/res).');
	}
	const BIOSRomName = SYSTEM_ROM_NAME;

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
		const checkBuild = () => isRebuildRequired(BIOSRomName, bootloader_path, BIOSResPath, {
			extraLuaPaths: [biosLuaPath, systemLuaPath],
			debug,
		});
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
	const systemRomLuaRoots = [normalizePathKey(biosLuaPath), normalizePathKey(systemLuaPath)];
	await runBIOSStep(TASK.BIOS_LINT, () => lintCartSources({ roots: systemRomLuaRoots, profile: 'bios' }));

	const BIOSResMetaList = await runBIOSStep(TASK.MANIFEST_SCAN, () => getResMetaList([BIOSResPath, biosLuaPath, systemLuaPath], BIOSRomName, {
		extraLuaPaths: [],
		virtualRoot: BIOSVirtualRoot,
	}));
	const BIOSResources = await runBIOSStep(TASK.RESOURCE_LIST, () => getResourcesList(BIOSResMetaList));
	await runBIOSStep(TASK.TEXTURE_BUILD, () => createTextureAtlases(BIOSResources));
	validateAudioEventReferences(BIOSResources);
	const BIOSRomAssets = await runBIOSStep(TASK.ROM_ASSETS, () => generateRomAssets(BIOSResources, message => progress?.setDetail(message)));
	const BIOSProgramBoot = appendProgramImage(BIOSRomAssets, SYSTEM_BOOT_ENTRY_PATH, {
		includeSymbols: debug,
		optLevel,
		programDomain: 'system',
	});
	stripLuaAssets(BIOSRomAssets, debug);
	await runBIOSStep(TASK.BIOS_FINALIZE, () => finalizeRompack(BIOSRomAssets, BIOSRomName, { projectRootPath: '', manifest: null, zipRom: false, debug, programBoot: BIOSProgramBoot }));
	if (progress) {
		await progress.showDone();
	}
	logOk(`BIOS assets ready → ${pc.white(`dist/${BIOSRomName}${debug ? '.debug' : ''}.rom`)}`);
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

		let { title, rom_name, bootloader_path, respath, force, debug, optLevel, mode, extraLuaRoots, libraryLuaRoots } = options;

		if (mode === 'bios') {
			progress = ui.createProgress(biosBuildTasks);
			await runBIOSBuild(options, progress);
			writeOut('\n');
			return;
		}

		progress = ui.createProgress(taskList);
		const isBIOSMode = false; // We keep this flag around for some options that still apply to the cart build (e.g. resource roots) and to avoid accidentally skipping code that should run in both modes. We know we are not in BIOS mode if we are in this branch, but we keep the flag for clarity.
		const romPackDebug = debug;
		const normalizedBootloader = normalizePathKey(bootloader_path);
		const cartRootFromRes = respath ? normalizePathKey(join(respath, '..')) : null;
		const projectRootFromRes = cartRootFromRes ? cartRootFromRes.replace(/^\.\//, '') : '';
		const projectRootFromBoot = normalizedBootloader.replace(/^\.\//, '');
		const projectRootPath = projectRootFromRes.length > 0
			? projectRootFromRes
			: (projectRootFromBoot.length > 0 ? projectRootFromBoot : null);
		const virtualRoot = projectRootPath;
		luaErrorVirtualRoots = [virtualRoot];

		const resourceRoots = isBIOSMode
			? [respath || commonResPath, biosLuaPath, systemLuaPath]
			: [respath || commonResPath, commonResPath];
		const extraLuaPathSet = new Set<string>(extraLuaRoots.map(normalizePathKey));
		const libraryLuaPathSet = new Set<string>(libraryLuaRoots.map(normalizePathKey));

		if (!rom_name && !isBIOSMode) {
			throw new Error('Missing required argument: --romname or ROM_NAME environment variable.');
		}

		if (rom_name) {
			if (rom_name.includes('.')) {
				throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'pietious'.`);
			}
			rom_name = rom_name.toLowerCase();
		}

		if (!title && !isBIOSMode) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		const romManifest = await getRomManifest(respath);
		if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
		const { gx_texture_layout, ...runtimeRomManifest } = romManifest;
		rom_name = romManifest.rom_name ?? rom_name;
		title = romManifest.title ?? title;
		romOutputPath = `dist/${rom_name}${romPackDebug ? '.debug' : ''}.rom`;

		logDivider('Run setup');
		logBullet('ROM', pc.bold(pc.white(rom_name)));
		logBullet('Title', pc.white(title));
		logBullet('Mode', pc.magenta(mode));
		logBullet('Bootloader', pc.white(normalizePathKey(bootloader_path)));
		logBullet('Resources', resourceRoots.length === 1
			? pc.white(resourceRoots[0])
			: `${pc.white(resourceRoots[0])} ${pc.dim('+ common ' + resourceRoots[1])}`);

		logDivider('Options');
		logBullet('Rebuild', force ? pc.yellow('force') : pc.green('auto (mtime check)'));
		logBullet('GX textures', pc.green('enabled'));
		logBullet('Lua case', pc.green('lower-case identifiers required'));
		logBullet('Build', debug ? pc.cyan('DEBUG') : pc.blue('NON-DEBUG'));
		logBullet('Opt level', pc.white(`-O${optLevel}`));
		if (!isBIOSMode) {
			const BIOSRomPath = join(process.cwd(), 'dist', `${SYSTEM_ROM_NAME}${romPackDebug ? '.debug' : ''}.rom`);
			if (!existsSync(BIOSRomPath)) {
				throw new Error(`BIOS ROM not found at "${BIOSRomPath}". Build the bios ROM first.`);
			}
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
			rebuildRequired = await progress.runWithDetail('Check timestamps', () => isRebuildRequired(rom_name, bootloader_path, respath, { extraLuaPaths: [...extraLuaPathSet, ...libraryLuaPathSet], debug }));
			if (!rebuildRequired && resourceRoots.length > 1) {
				for (let i = 1; i < resourceRoots.length; i++) {
					const candidate = resourceRoots[i];
					if (!candidate || candidate === respath) continue;
					const needs = await progress.runWithDetail('Check timestamps (shared)', () => isRebuildRequired(rom_name, bootloader_path, candidate, { extraLuaPaths: [...extraLuaPathSet, ...libraryLuaPathSet], debug }));
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
		romOutputPath = `dist/${rom_name}${romPackDebug ? '.debug' : ''}.rom`;

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
				gx_texture_layout,
				message => progress.setDetail(message),
			));
			await progress.taskCompleted();

			// Validate AEM references against loaded resources
			validateAudioEventReferences(resources);

			const romAssets = await progress.runWithDetail('Generate ROM assets', () => generateRomAssets(resources, message => progress.setDetail(message)));
			if (gx_texture_layout) {
				const source = buildGxTextureLayoutModuleSource(gx_texture_layout);
				romAssets.push({
					resid: GX_TEXTURE_LAYOUT_MODULE_PATH,
					type: 'lua',
					buffer: Buffer.from(source),
					compiled_buffer: compileLuaChunkBuffer(source, GX_TEXTURE_LAYOUT_MODULE_PATH),
					source_path: GX_TEXTURE_LAYOUT_SOURCE_PATH,
					update_timestamp: 0,
				});
			}
			const biosProgramContextAssets = await buildLuaProgramContextAssets([biosLuaPath, systemLuaPath], '');
			const assetSymbols = collectRomAssetSymbols(romAssets, romPackDebug, 'cart');
			const assetSymbolModuleSource = buildRomAssetSymbolModuleSourceFromSymbols(assetSymbols);
			const programBoot = appendProgramImage(romAssets, romManifest.lua.entry_path, {
				includeSymbols: romPackDebug,
				optLevel,
				programDomain: 'cart',
				externalLuaAssets: biosProgramContextAssets,
				generatedLuaModules: [{ path: ROM_ASSET_SYMBOL_MODULE_PATH, source: assetSymbolModuleSource }],
			});
			stripLuaAssets(romAssets, romPackDebug);
			await progress.taskCompleted();
			if (!isBIOSMode) {
				const cartLuaRoots = Array.from(extraLuaPathSet);
				const cartlibLuaRoots = Array.from(libraryLuaPathSet);
				const systemRomLuaRoots = [normalizePathKey(biosLuaPath), normalizePathKey(systemLuaPath)];
				await progress.runWithDetail('Lint cart + cartlib + system-ROM Lua', async () => {
					await lintCartSources({ roots: cartLuaRoots, profile: 'cart' });
					await lintCartSources({ roots: cartlibLuaRoots, profile: 'bios' });
					await lintCartSources({ roots: systemRomLuaRoots, profile: 'bios' });
				});
				await progress.taskCompleted();
			}

			await progress.runWithDetail('Finalize ROM pack', () => finalizeRompack(romAssets, rom_name, {
				projectRootPath,
				manifest: runtimeRomManifest,
				status: message => progress.setDetail(message),
				debug: romPackDebug,
				zipRom: false,
				programBoot,
				assetSymbolVerification: {
					expected: assetSymbols,
					includeLuaAssets: romPackDebug,
					defaultPayloadId: 'cart',
				},
			}));
			await progress.taskCompleted();
		}

		await progress.showDone();
		const romOutput = romOutputPath.length > 0 ? pc.white(romOutputPath) : pc.white('dist/<rom>.rom');
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
			const failedTask = progress.getCurrentTask();
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
