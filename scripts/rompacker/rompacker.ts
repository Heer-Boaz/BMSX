// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE ROMPACKER CANNOT HANDLE THIS!!!!!

import { validateAudioEventReferences } from './audioeventvalidator';
import { buildBootromScriptIfNewer, buildEngineRuntime, buildGameHtmlAndManifest, buildResourceList, createAtlasses, deployToServer, esbuild, finalizeRompack, generateRomAssets, getNodeLauncherFilename, getResMetaList, getResourcesList, getRomManifest, isRebuildRequired, typecheckBeforeBuild, typecheckGameWithDts } from './rompacker-core';
import type { Resource, RomManifest, RomPackerMode, RomPackerOptions, RomPackerTarget } from './rompacker.rompack';
const term = require('terminal-kit').terminal;
const _colors = require('colors');

import { join, isAbsolute } from 'path';
import { existsSync, statSync } from 'node:fs';

// Command line parameter for texture atlas usage
export let GENERATE_AND_USE_TEXTURE_ATLAS = true;
// Define common assets path
export const commonResPath = `./src/bmsx/res`;

// Global flag controlling whether Lua identifier case should be folded to lower-case.
// This must be declared before any code (including `main`) that may call
// `setCaseInsensitiveLua(...)`, otherwise modules that call the setter during
// initialization end up in the temporal-dead-zone for the variable and Node
// throws "Cannot access 'CASE_INSENSITIVE_LUA' before initialization".
export let CASE_INSENSITIVE_LUA = true;
export function setCaseInsensitiveLua(enabled: boolean): void {
	CASE_INSENSITIVE_LUA = enabled;
}

const KNOWN_FLAGS = new Set<string>([
	'-romname',
	'-title',
	'-bootloaderpath',
	'-respath',
	'--debug',
	'--force',
	'--buildreslist',
	'--nodeploy',
	'--deploy',
	'--mode',
	'--textureatlas',
	'--skiptypecheck',
	'--enginedts',
	'--usepkgtsconfig',
	'--platform',
	'--mode',
	'--preserve-lua-case',
	'-h',
	'--help',
]);

const FLAGS_WITH_VALUES = new Set<string>([
	'-romname',
	'-title',
	'-bootloaderpath',
	'-respath',
	'--textureatlas',
	'--enginedts',
	'--platform',
]);

type logentryType = undefined | 'error' | 'warning';
type TaskName =
	'Checken of rebuild nodig is' |
	'Rom manifest zoekeren en parseren' |
	'Game type-checkeren' |
	'Game compileren+bundleren' |
	'Resource lijst bouwen' |
	'Resources laden en metadata genereren' |
	'Atlassen puzellen (indien nodig)' |
	'Rom-assets genereren' |
	'Rompakket finaliseren' |
	`bootrom compileren` |
	'Platform-artifacts bouwen' |
	'Deployeren' |
	'ROM PACKING GE-DONUT!! :-)';

const taskList: TaskName[] = [
	'Checken of rebuild nodig is',
	'Rom manifest zoekeren en parseren',
	'Game type-checkeren',
	'Game compileren+bundleren',
	'Resource lijst bouwen',
	'Resources laden en metadata genereren',
	'Atlassen puzellen (indien nodig)',
	'Rom-assets genereren',
	'Rompakket finaliseren',
	`bootrom compileren`,
	'Platform-artifacts bouwen',
	'Deployeren',
	'ROM PACKING GE-DONUT!! :-)',
];

// --- Individual lists that allow us to easily remove tasks from the main task list (visualisation only!) ---
const romBuildTasks: TaskName[] = [
	'Rom manifest zoekeren en parseren',
	'Game compileren+bundleren',
	'Resource lijst bouwen',
	'Resources laden en metadata genereren',
	'Atlassen puzellen (indien nodig)',
	'Rom-assets genereren',
	'Rompakket finaliseren',
];

const deployTasks: TaskName[] = [
	'Deployeren',
];

// const bootromBuildTasks: TaskName[] = [
// 	`bootrom compileren`,
// ];

// const webTasks: TaskName[] = [
// 	'Platform-artifacts bouwen',
// ];

const rebuildCheckTasks: TaskName[] = [
	'Checken of rebuild nodig is',
];

const typecheckTasks: TaskName[] = [
	'Game type-checkeren',
];

const bundlerTasks: TaskName[] = [
	'Game compileren+bundleren',
];

// engine split task removed

function removeTaskNamesFromList(target: TaskName[], tasks: TaskName[]): void {
	for (const task of tasks) {
		const index = target.indexOf(task);
		if (index !== -1) {
			target.splice(index, 1);
		}
	}
}

function collectExistingDirectories(candidates: Array<string | undefined>): string[] {
	const visited = new Set<string>();
	const results: string[] = [];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const normalized = normalizePathKey(candidate);
		if (visited.has(normalized)) continue;
		visited.add(normalized);
		if (existsSync(normalized) && isDirectoryPath(normalized)) {
			results.push(normalized);
		}
	}
	return results;
}


// `process` is provided by Node and declared in @types/node; no local ambient needed.
function getParamOrEnv(args: string[], flag: string, envVar: string, fallback: string): string {
	const idx = args.indexOf(flag);
	if (idx !== -1) {
		const valueIdx = idx + 1;
		if (valueIdx >= args.length) {
			throw new Error(`Flag "${flag}" expects a value.`);
		}
		const candidate = args[valueIdx];
		if (KNOWN_FLAGS.has(candidate)) {
			throw new Error(`Flag "${flag}" expects a value, but received another flag "${candidate}".`);
		}
		return candidate;
	}
	const envValue = process.env[envVar];
	if (envValue && envValue.length > 0) return envValue;
	return fallback;
}

function parseArgsVector(argv: string[]): Set<string> {
	const seen = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('-')) continue;
		seen.add(token);
		if (FLAGS_WITH_VALUES.has(token)) {
			i += 1;
		}
	}
	return seen;
}

function getOptionalParam(args: string[], flag: string, envVar: string): string | undefined {
	const value = getParamOrEnv(args, flag, envVar, '');
	return value.length > 0 ? value : undefined;
}

function ensureRelativePath(candidate: string): string {
	if (!candidate) return candidate;
	if (isAbsolute(candidate)) return candidate;
	if (candidate.startsWith('./') || candidate.startsWith('../')) return candidate;
	return `./${candidate}`;
}

function normalizePathKey(candidate: string): string {
	return ensureRelativePath(candidate).replace(/\\/g, '/');
}

function isDirectoryPath(candidate: string): boolean {
	try {
		return statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

function findExistingDirectory(candidates: Array<string | undefined>): string | undefined {
	const visited = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate) continue;
		const normalized = normalizePathKey(candidate);
		if (visited.has(normalized)) continue;
		visited.add(normalized);
		if (existsSync(normalized) && isDirectoryPath(normalized)) {
			return normalized;
		}
	}
	return undefined;
}

function findBootloaderDirectory(candidates: Array<string | undefined>): string | undefined {
	const visited = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate) continue;
		const normalized = normalizePathKey(candidate);
		if (visited.has(normalized)) continue;
		visited.add(normalized);
		if (existsSync(join(normalized, 'bootloader.ts'))) {
			return normalized;
		}
	}
	return undefined;
}

function ensureMainLuaAssetPresent(manifest: RomManifest, resources: Resource[]): void {
	const luaConfig = manifest.lua;
	if (!luaConfig || !luaConfig.asset_id) {
		throw new Error(`Rom manifest must specify "lua.asset_id" for the primary Lua entry.`);
	}
	const assetId = luaConfig.asset_id.trim();
	if (assetId.length === 0) {
		throw new Error(`Rom manifest must specify "lua.asset_id" for the primary Lua entry.`);
	}
	const luaAssets = resources.filter(res => res.type === 'lua');
	const matchFound = luaAssets.some(res => res.name === assetId);
	if (!matchFound) {
		const available = luaAssets.map(res => res.name).join(', ') || '<none>';
		throw new Error(`Rom manifest references lua.asset_id "${assetId}", but no matching Lua resource was found in the packed resources. Available Lua assets: ${available}.`);
	}
}

function parseOptions(args: string[]): RomPackerOptions {
	const seenFlags = parseArgsVector(args);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		writeOut(`Usage: <command> [options]`, 'warning');
		writeOut(`Options:`, 'warning');
		writeOut(`  -romname <name>        Name of the ROM`, 'warning');
		writeOut(`  -title <title>         Title of the ROM`, 'warning');
		writeOut(`  -bootloaderpath <path> Path to the bootloader`, 'warning');
		writeOut(`  -respath <path>        Resource path`, 'warning');
		writeOut(`  --debug                Show this help message`, 'warning');
		writeOut(`  --force                Force the compilation and build of the rompack`, 'warning');
		writeOut(`  --buildreslist         Build resource list`, 'warning');
		writeOut(`  --nodeploy             Skip deployment (default)`, 'warning');
		writeOut(`  --deploy               Enable deployment (if configured)`, 'warning');
		writeOut(`  --textureatlas <yes|no>  Enable or disable texture atlas (default: yes)`, 'warning');
		writeOut(`  --preserve-lua-case      Disable Lua case folding (default: enabled)`, 'warning');
		writeOut(`  --enginedts <dir>        Use engine declarations from <dir> to type-check the game`, 'warning');
		writeOut(`  --usepkgtsconfig         Use per-game tsconfig.pkg.json for bundling/type-checking`, 'warning');
		writeOut(`  --platform <target>      Target platform: browser (default), cli, or headless`, 'warning');
		writeOut(`  --mode <bundle|engine>  Packaging mode (default: bundle)`, 'warning');
		process.exit(0);
	}

	const textureSetting = getOptionalParam(args, '--textureatlas', 'ROM_TEXTURE_ATLAS');
	let useTextureAtlas = true;
	if (textureSetting !== undefined) {
		const raw = textureSetting.toLowerCase();
		if (raw === 'yes' || raw === 'true' || raw === '1') {
			useTextureAtlas = true;
		} else if (raw === 'no' || raw === 'false' || raw === '0') {
			useTextureAtlas = false;
		} else {
			throw new Error(`Unsupported value "${raw}" for --textureatlas. Expected one of: yes, no, true, false, 1, 0.`);
		}
	}

	const rom_name = getParamOrEnv(args, '-romname', 'ROM_NAME', '');
	const title = getParamOrEnv(args, '-title', 'TITLE', rom_name);
	const defaultBootloaderPath = rom_name ? `./src/${rom_name}` : '';
	let bootloader_path = getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', defaultBootloaderPath);
	const defaultResPath = rom_name ? `${defaultBootloaderPath}/res` : '';
	let respath = getParamOrEnv(args, '-respath', 'RES_PATH', defaultResPath);

	const force = seenFlags.has('--force');
	const debug = seenFlags.has('--debug');
	const buildreslist = seenFlags.has('--buildreslist');
	let deploy = false;
	if (seenFlags.has('--deploy')) deploy = true;
	if (seenFlags.has('--nodeploy')) deploy = false;
	const skipTypecheck = seenFlags.has('--skiptypecheck');
	const enginedts = getOptionalParam(args, '--enginedts', 'ROM_ENGINE_DTS');
	const usePkgTsconfig = seenFlags.has('--usepkgtsconfig');
	const platformRaw = getParamOrEnv(args, '--platform', 'ROM_PLATFORM', 'browser');
	const platformKey = platformRaw.toLowerCase();
	let platform: RomPackerTarget;
	switch (platformKey) {
		case 'browser':
			platform = 'browser';
			break;
		case 'cli':
			platform = 'cli';
			break;
		case 'headless':
			platform = 'headless';
			break;
		default:
			throw new Error(`Unsupported platform target "${platformRaw}". Expected one of: browser, cli, headless.`);
	}

	const modeRaw = getParamOrEnv(args, '--mode', 'ROM_MODE', 'bundle');
	const modeStr = modeRaw.toLowerCase();
	let mode: RomPackerMode = 'bundle';
	if (modeStr === 'engine') {
		mode = 'engine';
	} else if (modeStr === 'bundle') {
		mode = 'bundle';
	} else {
		throw new Error(`Unsupported pack mode "${modeRaw}". Expected one of: bundle, engine.`);
	}

	const preserveLuaCase = seenFlags.has('--preserve-lua-case');
	const caseInsensitiveEnv = process.env.ROM_CASE_INSENSITIVE_LUA;
	let caseInsensitiveLua = true;
	if (caseInsensitiveEnv && caseInsensitiveEnv.length > 0) {
		const normalized = caseInsensitiveEnv.toLowerCase();
		if (normalized === '0' || normalized === 'false' || normalized === 'no') {
			caseInsensitiveLua = false;
		}
		else if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
			caseInsensitiveLua = true;
		}
		else {
			throw new Error(`Unsupported value "${caseInsensitiveEnv}" for ROM_CASE_INSENSITIVE_LUA. Expected one of: yes, no, true, false, 1, 0.`);
		}
	}
	else if (preserveLuaCase) {
		caseInsensitiveLua = false;
	}

	const normalizedRomName = rom_name.replace(/^[./\\]+/, '').replace(/\\/g, '/');
	const romSegments = normalizedRomName.split('/').filter(Boolean);
	const romLeaf = romSegments.length > 0 ? romSegments[romSegments.length - 1] : normalizedRomName;

	const bootloaderCandidates: Array<string | undefined> = [
		bootloader_path,
		normalizedRomName ? `./src/${normalizedRomName}` : undefined,
		normalizedRomName && romLeaf && romLeaf !== normalizedRomName ? `./src/${romLeaf}` : undefined,
		normalizedRomName ? `./src/carts/${normalizedRomName}` : undefined,
		romLeaf ? `./src/carts/${romLeaf}` : undefined,
	];

	const resolvedBootloaderDir = findBootloaderDirectory(bootloaderCandidates);
	let cartBootloaderFound = false;
	if (resolvedBootloaderDir) {
		bootloader_path = normalizePathKey(resolvedBootloaderDir);
		cartBootloaderFound = true;
	}

	const consoleBootloaderPath = normalizePathKey('./src/bmsx/console/default_cart');
	const bootloaderFile = join(normalizePathKey(bootloader_path), 'bootloader.ts');
	let bootloaderFallbackApplied = false;
	if (!existsSync(bootloaderFile)) {
		bootloader_path = consoleBootloaderPath;
		bootloaderFallbackApplied = true;
	}

	const resCandidates: Array<string | undefined> = [
		respath,
		normalizedRomName ? `./src/${normalizedRomName}/res` : undefined,
		normalizedRomName && romLeaf && romLeaf !== normalizedRomName ? `./src/${romLeaf}/res` : undefined,
		normalizedRomName && !normalizedRomName.startsWith('carts/') ? `./src/carts/${normalizedRomName}/res` : undefined,
		romLeaf ? `./src/carts/${romLeaf}/res` : undefined,
	];
	const resolvedResPath = findExistingDirectory(resCandidates);
	if (!resolvedResPath) {
		const attempted = resCandidates.filter(Boolean).map(normalizePathKey).join(', ');
		throw new Error(`Resource path "${respath}" does not exist. Tried: ${attempted || '<none>'}.`);
	}
	respath = normalizePathKey(resolvedResPath);
	const derivedCartRoot = normalizePathKey(join(respath, '..'));

	if (bootloaderFallbackApplied && normalizedRomName.length > 0) {
		writeOut(`Bootloader not found for ROM "${rom_name}". Using default cart bootloader at ${consoleBootloaderPath}.\n`, 'warning');
	}

	const isEngineMode = (mode === 'engine');
	let shouldBundleCartCode = !isEngineMode && cartBootloaderFound;
	if (!isEngineMode && bootloaderFallbackApplied) {
		shouldBundleCartCode = true;
	}

	const cartRootCandidates: Array<string | undefined> = [
		bootloader_path,
		derivedCartRoot,
		normalizedRomName ? `./src/${normalizedRomName}` : undefined,
		normalizedRomName && romLeaf && romLeaf !== normalizedRomName ? `./src/${romLeaf}` : undefined,
		normalizedRomName && !normalizedRomName.startsWith('carts/') ? `./src/carts/${normalizedRomName}` : undefined,
		romLeaf ? `./src/carts/${romLeaf}` : undefined,
	];
	const extraLuaRoots = collectExistingDirectories(cartRootCandidates);

	return {
		rom_name,
		title,
		bootloader_path,
		respath,
		force,
		debug,
		buildreslist,
		deploy,
		useTextureAtlas,
		enginedts,
		usePkgTsconfig,
		skipTypecheck,
		platform,
		caseInsensitiveLua,
		mode,
		shouldBundleCartCode,
		extraLuaRoots,
	};
}

function writeOut(_tolog: string, type?: logentryType): void {
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		case 'warning': tolog = _colors.yellow(_tolog); break;
		default: tolog = _tolog; break;
	}
	term(tolog);
}

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
}

class ProgressReporter {
	private gauge: any;
	private tasks: string[];
	private totalTasks: number;
	private completedTasks: number = 0;

	constructor(tasks: string[]) {
		// @ts-ignore
		const Gauge = require('gauge');
		this.gauge = new Gauge(process.stdout, {
			updateInterval: 20,
			cleanupOnExit: false,
			autoSize: false,
		});
		this.gauge.setTemplate([
			{ type: 'progressbar', length: 50 },
			{ type: 'section', kerning: 1, default: '' },
			{ type: 'subsection', kerning: 1, default: '' },
		]);
		this.tasks = [...tasks];
		this.totalTasks = tasks.length;
	}

	public async taskCompleted() {
		this.completedTasks++;
		const progressPercentage = this.completedTasks / this.totalTasks;
		if (this.tasks.length) {
			const currentTask = this.tasks.shift()!;
			this.gauge.show(currentTask, progressPercentage);
			await this.pulse();
		} else {
			await this.showDone();
		}
	}

	public showInitial() {
		if (this.tasks.length) {
			this.gauge.show(this.tasks[0], 0);
			this.gauge.pulse();
		}
	}

	public skipTasks(count: number) {
		for (let i = 0; i < count && this.tasks.length; i++) {
			this.tasks.shift();
			this.completedTasks++;
		}
	}

	public removeTask(task: string) {
		const index = this.tasks.indexOf(task);
		if (index !== -1) {
			this.tasks.splice(index, 1);
			this.totalTasks--;
		}
	}

	public removeTasks(tasks: string[]) {
		for (const task of tasks) {
			this.removeTask(task);
		}
	}

	public async showDone() {
		// this.gauge.show('ROM PACKING GE-DONUT!! :-)', 1);
		await this.pulse();
	}

	public async pulse() {
		this.gauge.pulse();
		await timer(20);
	}
}

async function main() {
	const outputError = (e: any) => writeOut(`\n[GEFAALD] ${e?.stack ?? e?.message ?? e ?? 'Geen melding en/of stacktrace beschikbaar :-('} \n`, 'error');
	const progress = new ProgressReporter(taskList);
	try {
		term.clear();
		writeOut(_colors.brightGreen.bold('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n'));
		writeOut(_colors.brightGreen.bold('┃                          BMSX ROMPACKER DOOR BOAZ©®™                           ┃\n'));
		writeOut(_colors.brightGreen.bold('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n'));

		const args = process.argv.slice(2);
		let { title, rom_name, bootloader_path, respath, force, debug, buildreslist, deploy, useTextureAtlas, enginedts, usePkgTsconfig, skipTypecheck, platform, caseInsensitiveLua, mode, shouldBundleCartCode, extraLuaRoots } = parseOptions(args);
		if (!shouldBundleCartCode && mode !== 'engine') {
			progress.removeTasks(bundlerTasks);
			progress.removeTasks(typecheckTasks);
			removeTaskNamesFromList(romBuildTasks, bundlerTasks);
		}
		const isEngineMode = mode === 'engine';
		const normalizedBootloader = normalizePathKey(bootloader_path);
		const cartRootFromRes = respath ? normalizePathKey(join(respath, '..')) : null;
		const projectRootFromRes = cartRootFromRes ? cartRootFromRes.replace(/^\.\//, '') : '';
		const projectRootFromBoot = normalizedBootloader.replace(/^\.\//, '');
		const projectRootPath = projectRootFromRes.length > 0
			? projectRootFromRes
			: (projectRootFromBoot.length > 0 ? projectRootFromBoot : null);
		const virtualRoot = projectRootPath ?? undefined;

		GENERATE_AND_USE_TEXTURE_ATLAS = useTextureAtlas;
		setAtlasFlag(useTextureAtlas);
		setCaseInsensitiveLua(caseInsensitiveLua);

		let resourceRoots: string[] = [];
		const extraLuaPathSet = new Set<string>(extraLuaRoots.map(normalizePathKey));

		if (buildreslist) {
			const primaryResPath = respath || commonResPath;
			if (!primaryResPath) {
				throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");
			}
			resourceRoots = isEngineMode
				? [primaryResPath]
				: [primaryResPath, commonResPath];
			if (!isEngineMode) {
				extraLuaPathSet.add(normalizePathKey(bootloader_path));
			}
			writeOut(`Building resource list from ${resourceRoots.map(r => `"${r}"`).join(' and ')}...\n`);
			writeOut('Note: ROM packing and deployment are skipped.\n');
			if (rom_name) {
				writeOut(`Note: ROM name is set to "${rom_name}" (not used for resource list building).\n`);
			}
			await buildResourceList(resourceRoots, rom_name || undefined, {
				extraLuaPaths: Array.from(extraLuaPathSet),
				includeCode: isEngineMode || shouldBundleCartCode,
				virtualRoot,
				resolveAtlasIndex: false,
			});
			writeOut(`\n${_colors.brightWhite.bold('[Resource list bouwen ge-DONUT]')} \n`);
			return;
		} else {
			// Check for required arguments
			if (!rom_name) {
				throw new Error('Missing required argument: --romname or ROM_NAME environment variable, or --buildreslist (to build resource list only).');
			}

			if (rom_name.includes('.')) {
				throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'testrom'.`);
			}
			rom_name = rom_name.toLowerCase();
		}

		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		resourceRoots = isEngineMode
			? [respath || commonResPath]
			: [respath || commonResPath, commonResPath];
		if (!isEngineMode && shouldBundleCartCode) {
			extraLuaPathSet.add(normalizePathKey(bootloader_path));
		}

		writeOut(`Target platform: ${platform}.\n`);
		if (resourceRoots.length === 1) {
			writeOut(`Using resources from "${resourceRoots[0]}"...\n`);
		} else {
			writeOut(`Using resources from "${resourceRoots[0]}" and common resources from "${resourceRoots[1]}"...\n`);
		}
		if (usePkgTsconfig) {
			writeOut(`Using per-game tsconfig.pkg.json for bundling/type-checking.\n`);
			const path = require('path');
			const fs = require('fs');
			const candidates = [
				path.join(path.resolve(bootloader_path), 'node_modules', 'bmsx', 'package.json'),
				path.join(process.cwd(), 'node_modules', 'bmsx', 'package.json'),
			];
			let found = false;
			for (const p of candidates) {
				try { fs.accessSync(p); found = true; break; } catch { /* try next */ }
			}
			if (!found) {
				writeOut(
					`ERROR: package "bmsx" not found in node_modules for this game.\n` +
					`Run "npm install" at the repo root (workspaces) or pin a tarball in the game's package.json, then try again.\n` +
					`Cannot proceed with --usepkgtsconfig.\n`,
					'error'
				);
				throw new Error('Missing package "bmsx" for --usepkgtsconfig');
			}
		}

		let rebuildRequired = true;
		if (force) {
			writeOut(`Note: Recompilation and building forced via ${_colors.yellow.bold('--force')} \n`);
			progress.removeTasks(rebuildCheckTasks);
		}
		else {
			writeOut(`Note: Recompilation and building only if required (based on file modification times).\n`);
		}
		if (useTextureAtlas) {
			writeOut(`Note: Texture atlas generation enabled via ${_colors.brightGreen.bold('--textureatlas yes')} \n`);
		}
		else {
			writeOut(`Note: Texture atlas generation disabled via ${_colors.brightRed.bold('--textureatlas no')} \n`);
		}
		if (caseInsensitiveLua) {
			writeOut(`Note: Lua case folding enabled (engine expects lowercase Lua identifiers).\n`);
		} else {
			writeOut(`Note: Lua case folding disabled via ${_colors.brightRed.bold('--preserve-lua-case')} or ROM_CASE_INSENSITIVE_LUA.\n`);
		}
		if (!deploy) {
			writeOut(`Note: Deploy to FTP server disabled via ${_colors.brightRed.bold('--nodeploy')} \n`);
			progress.removeTasks(deployTasks);
		}
		if (skipTypecheck) {
			writeOut(`Skipping type-checking of the game as per ${_colors.brightRed.bold('--skiptypecheck')}.\n`);
			progress.removeTasks(typecheckTasks);
		}
		// split-engine removed
		writeOut(`Starting ROM packing and deployment process for ROM ${_colors.brightBlue.bold(`${rom_name}`)}...\n`);
		if (resourceRoots.length === 1) {
			writeOut(`Using resources from "${resourceRoots[0]}"...\n`);
		} else {
			writeOut(`Using resources from "${resourceRoots[0]}" and common resources from "${resourceRoots[1]}"...\n`);
		}
		if (usePkgTsconfig) writeOut(`Using per-game tsconfig.pkg.json for bundling/type-checking.\n`);
		if (debug) {
			writeOut(`${_colors.cyan.bold('Building DEBUG version of rompack.')}.\n`);
		}
		else {
			writeOut(`${_colors.cyan.bold('Building NON-DEBUG version of rompack.')}.\n`);
		}
		try {
			progress.showInitial();
			await progress?.taskCompleted(); // Need to complete the initial task as it will be triggered twice or so

			if (!force) {
				const includeCode = isEngineMode || shouldBundleCartCode;
				rebuildRequired = await isRebuildRequired(rom_name, bootloader_path, respath, { includeCode, extraLuaPaths: Array.from(extraLuaPathSet), resolveAtlasIndex: false });
				if (!rebuildRequired && resourceRoots.length > 1) {
					for (let i = 1; i < resourceRoots.length; i++) {
						const candidate = resourceRoots[i];
						if (!candidate || candidate === respath) continue;
						const needs = await isRebuildRequired(rom_name, bootloader_path, candidate, { includeCode, extraLuaPaths: Array.from(extraLuaPathSet), resolveAtlasIndex: true });
						rebuildRequired = rebuildRequired || needs;
						if (rebuildRequired) break;
					}
				}
				if (!rebuildRequired) {
					writeOut('Rebuild skipped: game rom was newer than code/assets (use --force option to ignore this check).\n');
				}
				await progress?.taskCompleted();
			} else rebuildRequired = true;
			if (!rebuildRequired) {
				progress?.removeTasks(romBuildTasks);
			}

			let romManifest: RomManifest;
			let short_name: string = 'BMSX';
			romManifest = await getRomManifest(respath);
			await progress.taskCompleted();
			if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
			rom_name = romManifest?.rom_name ?? rom_name;
			title = romManifest?.title ?? title;
			short_name = romManifest?.short_name ?? short_name;

			if (rebuildRequired) {
				// Type-check engine and game prior to bundling unless skipped
				if (!skipTypecheck && (isEngineMode || shouldBundleCartCode)) {
					const tsProject = usePkgTsconfig ? `${bootloader_path}/tsconfig.pkg.json` : undefined;
					try {
						if (enginedts) typecheckGameWithDts(bootloader_path, enginedts, tsProject);
						else typecheckBeforeBuild(bootloader_path, tsProject);
					} catch (e) { throw e; }

					// Ensure tasks are removed
					await progress?.taskCompleted();
				}
				const tsProject = usePkgTsconfig ? `${bootloader_path}/tsconfig.pkg.json` : undefined;
				if (isEngineMode) {
					await buildEngineRuntime({ debug });
				} else if (shouldBundleCartCode) {
					await esbuild(rom_name, bootloader_path, debug, tsProject);
				}
				await progress?.taskCompleted();
				const romResMetaList = await getResMetaList(resourceRoots, rom_name, {
					includeCode: isEngineMode || shouldBundleCartCode,
					extraLuaPaths: Array.from(extraLuaPathSet),
					virtualRoot,
					resolveAtlasIndex: true,
				});
				await progress?.taskCompleted();
				ensureMainLuaAssetPresent(romManifest, romResMetaList);
				// Build resources
				let resources = await getResourcesList(romResMetaList, rom_name, {
					includeCode: isEngineMode || shouldBundleCartCode,
				});
				await progress?.taskCompleted();

				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					await createAtlasses(resources);
				}
				await progress?.taskCompleted();

				// Validate AEM references against loaded resources
				validateAudioEventReferences(resources);

				const romAssets = await generateRomAssets(resources);
				await progress?.taskCompleted();

				await finalizeRompack(romAssets, rom_name, debug, { projectRootPath });
				await progress?.taskCompleted();
			}

			await buildBootromScriptIfNewer({ debug, forceBuild: force, platform, romName: rom_name, caseInsensitiveLua });
			await progress?.taskCompleted();
			if (platform === 'browser') {
				if (!isEngineMode) {
					await buildGameHtmlAndManifest(rom_name, title, short_name, debug);
				}
			} else {
				const launcherName = getNodeLauncherFilename(platform, debug);
				writeOut(`Generated Node launcher "dist/${launcherName}" for platform "${platform}".\n`);
			}
			await progress?.taskCompleted();
			if (deploy) {
				await deployToServer(rom_name, title);
				await progress?.taskCompleted();
			}
			await progress?.showDone();
			writeOut(`\n`);
		} catch (e) {
			await progress.pulse();
			writeOut(`\n`);
			throw e;
		}
	} catch (e) {
		outputError(e);
	}
}

main(); export function setAtlasFlag(enabled: boolean): void {
	GENERATE_AND_USE_TEXTURE_ATLAS = enabled;
}
export function getAtlasFlag(): boolean {
	return GENERATE_AND_USE_TEXTURE_ATLAS;
}
export const ENGINE_ATLAS_INDEX = 254; // Keep in sync with src/bmsx/render/atlas.ts
// CASE_INSENSITIVE_LUA and its setter are declared earlier in the file to avoid
// temporal-dead-zone issues when they are used during module initialization.
