// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE BUILDER CANNOT HANDLE THIS!!!!!

import pc from 'picocolors';
import { Presets, SingleBar } from 'cli-progress';

import { createCliUi, findExistingDirectory, getParamOrEnv, isDirectoryPath, normalizePathKey, parseArgsVector } from './cli_shared';
import { validateAudioEventReferences } from './audioeventvalidator';
import { lintCartLuaSources } from './cart_lua_linter';
import { appendProgramAsset, buildResourceList, commonResPath, createAtlasses, ENGINE_ATLAS_INDEX, esbuild, finalizeRompack, GENERATE_AND_USE_TEXTURE_ATLAS, generateRomAssets, getResMetaList, getResourcesList, getRomManifest, isRebuildRequired, LUA_CANONICALIZATION, setAtlasFlag, setLuaCanonicalization, typecheckBeforeBuild, typecheckGameWithDts } from './rombuilder';
import type { AtlasResource, Resource, RomPackerOptions } from './rompacker.rompack';
import type { CanonicalizationType, RomAsset, RomManifest } from '../../src/bmsx/rompack/rompack';
import { LuaError } from '../../src/bmsx/lua/luaerrors';

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// CASE_INSENSITIVE_LUA and its setter are declared earlier in the file to avoid
// temporal-dead-zone issues when they are used during module initialization.

type ParsedOptions = RomPackerOptions & { bootloaderFallbackPath?: string; };
const ui = createCliUi({ bannerTitle: 'BMSX BUILDER', labelWidth: 14 });
const writeOut = ui.writeOut;
const printBanner = ui.printBanner;
const logInfo = ui.info;
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
	'--buildreslist',
	'--textureatlas',
	'--skiptypecheck',
	'--enginedts',
	'--usepkgtsconfig',
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
]);
const OPT_LEVEL_RE = /^-O([0-3])$/;

const TASK = {
	REBUILD_CHECK: 'Checken of rebuild nodig is',
	MANIFEST_SCAN: 'Rom manifest zoekeren en parseren',
	GAME_TYPECHECK: 'Game type-checkeren',
	GAME_BUNDLE: 'Game compileren+bundleren',
	CART_LUA_LINT: 'Cart Lua linten',
	RESOURCE_LIST: 'Resource lijst bouwen',
	RESOURCE_LOAD: 'Resources laden en metadata genereren',
	ATLAS_BUILD: 'Atlassen puzellen (indien nodig)',
	ROM_ASSETS: 'Rom-assets genereren',
	ROM_FINALIZE: 'Rompakket finaliseren',
	DONE: 'ROM PACKING GE-DONUT!! :-)',
} as const;

type TaskName = typeof TASK[keyof typeof TASK];

const taskList: TaskName[] = [
	TASK.REBUILD_CHECK,
	TASK.MANIFEST_SCAN,
	TASK.GAME_TYPECHECK,
	TASK.GAME_BUNDLE,
	TASK.RESOURCE_LIST,
	TASK.RESOURCE_LOAD,
	TASK.ATLAS_BUILD,
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

function applyEngineAtlasLimit(manifest: RomManifest, resources: Resource[]): void {
	const atlas = resources.find((res): res is AtlasResource => res.type === 'atlas' && res.atlasid === ENGINE_ATLAS_INDEX);
	if (!atlas || !atlas.img) {
		throw new Error('[RomPacker] Engine atlas missing; cannot compute system_atlas_slot_bytes.');
	}
	const width = atlas.img.width;
	const height = atlas.img.height;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new Error('[RomPacker] Engine atlas dimensions are invalid; cannot compute system_atlas_slot_bytes.');
	}
	const bytes = Math.floor(width) * Math.floor(height) * 4;
	let vramSpecs = manifest.machine.specs.vram;
	if (!vramSpecs) {
		vramSpecs = {};
		manifest.machine.specs.vram = vramSpecs;
	}
	vramSpecs.system_atlas_slot_bytes = bytes;
}

// --- Individual lists that allow us to easily remove tasks from the main task list (visualisation only!) ---
const romBuildTasks: TaskName[] = taskList.slice(1, -1);

// const bootromBuildTasks: TaskName[] = [
// 	`bootrom compileren`,
// ];

// const webTasks: TaskName[] = [
// 	'Platform-artifacts bouwen',
// ];

const rebuildCheckTasks: TaskName[] = [TASK.REBUILD_CHECK];

const typecheckTasks: TaskName[] = [TASK.GAME_TYPECHECK];

const bundlerTasks: TaskName[] = [TASK.GAME_BUNDLE];

// engine split task removed

function removeTaskNamesFromList(target: TaskName[], tasks: TaskName[]): void {
	for (const task of tasks) {
		const index = target.indexOf(task);
		if (index !== -1) {
			target.splice(index, 1);
		}
	}
}

function collectExistingDirectories(candidates: Array<string>): string[] {
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

function findBootloaderDirectory(candidates: Array<string>): string {
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

function parseOptions(args: string[]): ParsedOptions {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag) && !OPT_LEVEL_RE.test(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		writeOut(`Usage: <command> [options]\n`, 'warning');
		writeOut(`Options:\n`, 'warning');
		writeOut(`  -romname <name>        Name of the ROM\n`, 'warning');
		writeOut(`  -title <title>         Title of the ROM\n`, 'warning');
		writeOut(`  -bootloaderpath <path> Path to the bootloader\n`, 'warning');
		writeOut(`  -respath <path>        Resource path\n`, 'warning');
		writeOut(`  --debug                Build debug artifacts\n`, 'warning');
		writeOut(`  --force                Force the compilation and build of the rompack\n`, 'warning');
		writeOut(`  --buildreslist         Build resource list\n`, 'warning');
		writeOut(`  --textureatlas <yes|no>  Enable or disable texture atlas (default: yes)\n`, 'warning');
		writeOut(`  --preserve-lua-case      Disable Lua case folding (default: enabled)\n`, 'warning');
		writeOut(`  --enginedts <dir>        Use engine declarations from <dir> to type-check the game\n`, 'warning');
		writeOut(`  --usepkgtsconfig         Use per-game tsconfig.pkg.json for bundling/type-checking\n`, 'warning');
		writeOut(`  --mode <rompack|engine>  What to build (default: rompack)\n`, 'warning');
		writeOut(`  -O0|-O1|-O2|-O3         Bytecode optimizer level (default: -O3)\n`, 'warning');
		process.exit(0);
	}

	const optLevel = parseOptLevel(args);

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

	const force = seenFlags.has('--force');
	const debug = seenFlags.has('--debug');
	const buildreslist = seenFlags.has('--buildreslist');
	const skipTypecheck = seenFlags.has('--skiptypecheck');
	const enginedts = getOptionalParam(args, '--enginedts', 'ROM_ENGINE_DTS');
	const usePkgTsconfig = seenFlags.has('--usepkgtsconfig');

	const modeRaw = getParamOrEnv(args, '--mode', 'ROM_MODE', 'rompack', KNOWN_FLAGS);
	const modeStr = modeRaw.toLowerCase();
	let mode: 'rompack' | 'engine';
	if (modeStr === 'rompack') {
		mode = 'rompack';
	} else if (modeStr === 'engine') {
		mode = 'engine';
	} else {
		throw new Error(`Unsupported --mode "${modeRaw}". Expected one of: rompack, engine.`);
	}

	const rom_name = getParamOrEnv(args, '-romname', 'ROM_NAME', '', KNOWN_FLAGS);
	const title = getParamOrEnv(args, '-title', 'TITLE', rom_name, KNOWN_FLAGS);
	const defaultBootloaderPath = mode === 'engine'
		? './src/bmsx/emulator/default_cart'
		: (rom_name ? `./src/${rom_name}` : '');
	let bootloader_path = getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', defaultBootloaderPath, KNOWN_FLAGS);
	const defaultResPath = mode === 'engine'
		? './src/bmsx/res'
		: (rom_name ? `${defaultBootloaderPath}/res` : '');
	let respath = getParamOrEnv(args, '-respath', 'RES_PATH', defaultResPath, KNOWN_FLAGS);

	const preserveLuaCase = seenFlags.has('--preserve-lua-case');
	const canonicalizationEnv = process.env.ROM_LUA_CANONICALIZATION;
	let canonicalization: CanonicalizationType = 'lower'; // By default we fold to lower case to align with JS conventions
	if (canonicalizationEnv && canonicalizationEnv.length > 0) {
		if (canonicalizationEnv === 'none' || canonicalizationEnv === 'lower' || canonicalizationEnv === 'upper') {
			canonicalization = canonicalizationEnv;
		} else {
			throw new Error(`Unsupported value "${canonicalizationEnv}" for ROM_LUA_CANONICALIZATION. Expected one of: 'none', 'lower', 'upper'.`);
		}
	}
	else if (preserveLuaCase) {
		canonicalization = 'none';
	}

	const normalizedRomName = rom_name.replace(/^[./\\]+/, '').replace(/\\/g, '/');
	const romSegments = normalizedRomName.split('/').filter(Boolean);
	const romLeaf = romSegments.length > 0 ? romSegments[romSegments.length - 1] : normalizedRomName;

	const bootloaderCandidates: Array<string> = [
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

	const engineDefaultBootloaderPath = normalizePathKey('./src/bmsx/emulator/default_cart');
	const bootloaderFile = join(normalizePathKey(bootloader_path), 'bootloader.ts');
	let bootloaderFallbackApplied = false;
	if (!existsSync(bootloaderFile)) {
		bootloader_path = engineDefaultBootloaderPath;
		bootloaderFallbackApplied = true;
	}
	const bootloaderFallbackPath = bootloaderFallbackApplied ? engineDefaultBootloaderPath : undefined;

	const resCandidates: Array<string> = [
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

	const isEngineMode = (mode === 'engine');
	let shouldBundleCartCode = !isEngineMode && cartBootloaderFound;

	const cartRootCandidates: Array<string> = [
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
		useTextureAtlas,
		enginedts,
		usePkgTsconfig,
		skipTypecheck,
		platform: 'browser',
		canonicalization,
		optLevel,
		mode,
		shouldBundleCartCode,
		extraLuaRoots,
		bootloaderFallbackPath,
	};
}

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
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
		const sourceLines = source.replace(/\r\n|\r/g, '\n').split('\n');
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

class ProgressReporter {
	private bar: SingleBar;
	private tasks: string[];
	private totalTasks: number;
	private completedTasks = 0;
	private started = false;
	private detail = '';
	private suspended = false;
	private failed = false;

	constructor(tasks: string[]) {
		this.tasks = [...tasks];
		this.totalTasks = this.tasks.length;
		this.bar = new SingleBar({
			format: `${pc.dim('[')}${pc.green('{bar}')}${pc.dim(']')} ${pc.dim('{value}/{total}')} ${pc.cyan('{percentage}%')} {task} {detail}`,
			barCompleteChar: '█',
			barIncompleteChar: '░',
			barsize: 80,
			hideCursor: true,
			stopOnComplete: false,
			align: 'left',
			fps: 10,
			clearOnComplete: false,
		}, Presets.shades_classic);
	}
	private currentTask(): string {
		return this.tasks[0] as string;
	}
	public getCurrentTask(): string {
		return this.currentTask();
	}

	private recalcTotals(): void {
		this.totalTasks = this.completedTasks + this.tasks.length;
	}

	private sync(label?: string): void {
		if (!this.started) return;
		const total = this.totalTasks || 1;
		this.bar.setTotal(total);
		const taskLabel = label ?? this.currentTask();
		const detailLabel = this.detail ? pc.dim(`· ${this.detail}`) : '';
		this.bar.update(this.completedTasks, { task: taskLabel, detail: detailLabel });
	}

	public async taskCompleted() {
		const finishedTask = this.tasks.shift() as string;
		this.completedTasks++;
		this.detail = '';
		this.recalcTotals();
		this.sync(this.currentTask() || finishedTask);
		await this.pulse();
		if (!this.tasks.length) {
			this.bar.update(this.completedTasks, { task: finishedTask });
		}
	}

	public showInitial() {
		if (this.started) return;
		this.started = true;
		const total = this.totalTasks || 1;
		this.bar.start(total, this.completedTasks, { task: this.currentTask() });
	}

	public skipTasks(count: number) {
		for (let i = 0; i < count && this.tasks.length; i++) {
			this.tasks.shift();
			this.completedTasks++;
		}
		this.recalcTotals();
		this.sync();
	}

	public removeTask(task: string) {
		const index = this.tasks.indexOf(task);
		if (index === -1) {
			throw new Error(`ProgressReporter cannot remove unknown task "${task}".`);
		}
		this.tasks.splice(index, 1);
		this.recalcTotals();
		this.sync();
	}

	public removeTasks(tasks: string[]) {
		for (const task of tasks) {
			this.removeTask(task);
		}
	}

	public async showDone() {
		if (this.started && !this.suspended && !this.failed) {
			this.bar.update(this.totalTasks || this.completedTasks, { task: 'Gereed' });
			this.bar.stop();
		}
		await this.pulse();
	}

	public async pulse() {
		await timer(100);
	}

	public setDetail(detail: string) {
		this.detail = detail;
		this.sync();
	}

	public clearDetail() {
		this.detail = '';
		this.sync();
	}

	public async runWithDetail<T>(detail: string, action: () => Promise<T>): Promise<T> {
		this.setDetail(detail);
		try {
			return await action();
		} finally {
			this.clearDetail();
		}
	}

	public suspend() {
		if (!this.started || this.suspended) return;
		this.bar.stop();
		this.suspended = true;
		process.stdout.write('\n');
	}

	public resume(label?: string) {
		if (!this.started || !this.suspended) return;
		this.suspended = false;
		const total = this.totalTasks || 1;
		this.bar.start(total, this.completedTasks, {
			task: label ?? this.currentTask(),
			detail: this.detail ? pc.dim(`· ${this.detail}`) : '',
		});
	}

	public async runWithOutput<T>(detail: string, action: () => Promise<T>): Promise<T> {
		this.setDetail(detail);
		try {
			return await action();
		} finally {
			this.clearDetail();
		}
	}

	public stop() {
		if (!this.started) return;
		if (!this.suspended) this.bar.stop();
		this.started = false;
	}

	public fail(task: string, summary: string) {
		if (!this.started) return;
		this.failed = true;
		const taskLabel = task || 'Pipeline';
		const detailLabel = pc.red(`✘ ${summary}`);
		this.bar.update(this.completedTasks, { task: pc.red(taskLabel), detail: detailLabel });
		this.bar.stop();
		this.suspended = true;
	}
}

async function runEngineBuild(options: ParsedOptions): Promise<void> {
	const { respath, bootloader_path, force, debug, optLevel, canonicalization, useTextureAtlas } = options;

	setAtlasFlag(useTextureAtlas);
	setLuaCanonicalization(canonicalization);

	const engineResPath = respath || commonResPath;
	if (!engineResPath) {
		throw new Error('Missing engine respath (expected ./src/bmsx/res).');
	}
	const engineManifest = await getRomManifest(engineResPath);
	if (!engineManifest) {
		throw new Error(`Rom manifest not found at "${engineResPath}"!`);
	}
	const engineRomName = engineManifest.rom_name ?? 'bmsx-bios';

	const engineProjectRoot = normalizePathKey(join(engineResPath, '..'));
	const engineProjectRootPath = engineProjectRoot.replace(/^\.\//, '');
	const engineVirtualRoot = engineProjectRootPath;

	logDivider('Engine');
	logBullet('ROM', pc.bold(pc.white(engineRomName)));
	logBullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));

	const assetsNeedRebuild = force || await isRebuildRequired(engineRomName, bootloader_path, engineResPath, {
		includeCode: false,
		extraLuaPaths: [],
		resolveAtlasIndex: false,
		debug,
	});
	if (!assetsNeedRebuild) {
		logInfo('Engine assets up-to-date (use --force to rebuild)');
		return;
	}

	logInfo(`Build engine assets (${engineRomName})`);
	const previousCanonicalization = LUA_CANONICALIZATION;
	const engineCanonicalization = engineManifest.machine.canonicalization ?? previousCanonicalization;
	setLuaCanonicalization(engineCanonicalization);
	try {
		const engineResMetaList = await getResMetaList([engineResPath], engineRomName, {
			includeCode: false,
			extraLuaPaths: [],
			virtualRoot: engineVirtualRoot,
			resolveAtlasIndex: true,
		});
		const engineResources = await getResourcesList(engineResMetaList);
		if (GENERATE_AND_USE_TEXTURE_ATLAS) {
			await createAtlasses(engineResources);
			applyEngineAtlasLimit(engineManifest, engineResources);
		}
		validateAudioEventReferences(engineResources);
		const engineRomAssets = await generateRomAssets(engineResources);
		appendProgramAsset(engineRomAssets, engineManifest, { includeSymbols: debug, optLevel });
		stripLuaAssets(engineRomAssets, debug);
		await finalizeRompack(engineRomAssets, engineRomName, { projectRootPath: engineProjectRootPath, manifest: engineManifest, zipRom: false, debug });
		logOk(`Engine assets ready → ${pc.white(`dist/${engineRomName}${debug ? '.debug' : ''}.rom`)}`);
	} finally {
		setLuaCanonicalization(previousCanonicalization);
	}
}

async function main() {
	let progress: ProgressReporter;
	let romOutputPath = '';
	let luaErrorVirtualRoots: string[] = [];
	const bufferedLogs: string[] = [];
	const captureLog = (text: string) => {
		if (!text) return;
		const trimmed = text.trimEnd();
		if (trimmed.length === 0) return;
		bufferedLogs.push(trimmed);
	};
	try {
		printBanner();

		const args = process.argv.slice(2);
		const options = parseOptions(args);

		let { title, rom_name, bootloader_path, respath, force, debug, buildreslist, useTextureAtlas, enginedts, usePkgTsconfig, skipTypecheck, canonicalization, optLevel, mode, shouldBundleCartCode, extraLuaRoots, bootloaderFallbackPath } = options;

		if (mode === 'engine' && !buildreslist) {
			await runEngineBuild(options);
			writeOut('\n');
			return;
		}

		progress = new ProgressReporter(taskList);
		if (!shouldBundleCartCode && mode !== 'engine') {
			progress.removeTasks(bundlerTasks);
			removeTaskNamesFromList(romBuildTasks, bundlerTasks);
		}
		const isEngineMode = mode === 'engine';
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

		setAtlasFlag(useTextureAtlas);
		setLuaCanonicalization(canonicalization);

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
			logDivider('Resource list');
			logInfo(`Building from ${resourceRoots.map(r => pc.white(`"${r}"`)).join(pc.dim(' and '))}`);
			logWarn('ROM packing and deployment are skipped');
			if (rom_name) {
				logInfo(`ROM name set to ${pc.bold(`"${rom_name}"`)} (not used for list building)`);
			}
			await buildResourceList(resourceRoots, rom_name || undefined, {
				extraLuaPaths: Array.from(extraLuaPathSet),
				includeCode: shouldBundleCartCode,
				virtualRoot,
				resolveAtlasIndex: false,
			});
			writeOut(`\n${pc.bold(pc.white('[Resource list bouwen ge-DONUT]'))} \n`);
			return;
		} else {
			// Check for required arguments
			if (!rom_name && !isEngineMode) {
				throw new Error('Missing required argument: --romname or ROM_NAME environment variable, or --buildreslist (to build resource list only).');
			}

			if (rom_name) {
				if (rom_name.includes('.')) {
					throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'testrom'.`);
				}
				rom_name = rom_name.toLowerCase();
			}
		}

		if (!title && !isEngineMode) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		resourceRoots = isEngineMode
			? [respath || commonResPath]
			: [respath || commonResPath, commonResPath];
		if (!isEngineMode && shouldBundleCartCode) {
			extraLuaPathSet.add(normalizePathKey(bootloader_path));
		}
		let romManifest = await getRomManifest(respath);
		if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
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
		if (bootloaderFallbackPath && !isEngineMode) {
			logWarn(`Bootloader not found for ROM "${rom_name}". Using default cart bootloader at ${pc.white(bootloaderFallbackPath)}.`);
		}
		let pkgTsconfigPath: string;
		if (usePkgTsconfig) {
			logBullet('tsconfig', pc.white('tsconfig.pkg.json (per-game)'));
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
			const candidatePkgTsconfig = normalizePathKey(join(bootloader_path, 'tsconfig.pkg.json'));
			if (existsSync(candidatePkgTsconfig)) {
				pkgTsconfigPath = candidatePkgTsconfig;
			} else {
				logWarn(`tsconfig.pkg.json not found at ${candidatePkgTsconfig}; falling back to default tsconfig.json`);
			}
		}

		logDivider('Options');
		logBullet('Rebuild', force ? pc.yellow('force') : pc.green('auto (mtime check)'));
		logBullet('Atlas', useTextureAtlas ? pc.green('enabled') : pc.red('disabled'));
		logBullet('Lua case', canonicalization !== 'none' ? pc.green(`fold ${canonicalization}`) : pc.yellow('preserve case'));
		logBullet('Typecheck', skipTypecheck ? pc.red('skipped') : pc.green('enabled'));
		logBullet('Build', debug ? pc.cyan('DEBUG') : pc.blue('NON-DEBUG'));
		logBullet('Opt level', pc.white(`-O${optLevel}`));

		const includeCode = shouldBundleCartCode;
		if (!isEngineMode && mode === 'rompack') {
			const engineResPath = commonResPath;
			const engineManifest = await getRomManifest(engineResPath);
			if (!engineManifest) {
				throw new Error(`Engine manifest not found at "${engineResPath}".`);
			}
			const engineRomName = engineManifest.rom_name ?? 'bmsx-bios';
			const engineRomPath = join(process.cwd(), 'dist', `${engineRomName}${romPackDebug ? '.debug' : ''}.rom`);
			if (!existsSync(engineRomPath)) {
				throw new Error(`Engine ROM not found at "${engineRomPath}". Build the engine ROM first.`);
			}
		}

		let rebuildRequired = true;
		if (force) {
			progress.removeTasks(rebuildCheckTasks);
		}
		else {
			logInfo('Rebuild only if inputs are newer than outputs');
		}
		if (skipTypecheck) {
			progress.removeTasks(typecheckTasks);
			removeTaskNamesFromList(romBuildTasks, typecheckTasks);
		}
		// split-engine removed
		logDivider('Pipeline');
		let typeCheckError: Error = null;
		logInfo(`Starting for ${pc.bold(pc.blue(`${rom_name}`))}`);

		if (!force) {
			rebuildRequired = await progress.runWithDetail('Check timestamps', () => isRebuildRequired(rom_name, bootloader_path, respath, { includeCode, extraLuaPaths: Array.from(extraLuaPathSet), resolveAtlasIndex: false, debug }));
			if (!rebuildRequired && resourceRoots.length > 1) {
				for (let i = 1; i < resourceRoots.length; i++) {
					const candidate = resourceRoots[i];
					if (!candidate || candidate === respath) continue;
					const needs = await progress.runWithDetail('Check timestamps (shared)', () => isRebuildRequired(rom_name, bootloader_path, candidate, { includeCode, extraLuaPaths: Array.from(extraLuaPathSet), resolveAtlasIndex: true, debug }));
					rebuildRequired = rebuildRequired || needs;
					if (rebuildRequired) break;
				}
			}
			if (!rebuildRequired) {
				logInfo('Rebuild skipped: game rom is newer than code/assets (use --force to override)');
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
			// Type-check engine and game prior to bundling unless skipped
			if (!skipTypecheck) {
				const tsProject = pkgTsconfigPath;
				const stepLogs: string[] = [];
				const push = (text: string) => text && stepLogs.push(text);
				try {
					await progress.runWithOutput('Type-check', async () => {
						if (enginedts) typecheckGameWithDts(bootloader_path, enginedts, push, tsProject);
						else typecheckBeforeBuild(bootloader_path, push, tsProject);
					});
					// Capture type-check output even if it didn't throw
					stepLogs.forEach(captureLog);
				} catch (err) {
					stepLogs.forEach(captureLog);
					throw err;
				}

				// Ensure tasks are removed
				await progress.taskCompleted();
			}
			const tsProject = pkgTsconfigPath;
			if (shouldBundleCartCode) {
				const stepLogs: string[] = [];
				try {
					await progress.runWithOutput('Bundle cart code', () => esbuild(rom_name, bootloader_path, debug, tsProject));
				} catch (err) {
					stepLogs.push(...formatEsbuildErrors(err));
					stepLogs.forEach(captureLog);
					throw err;
				}
				await progress.taskCompleted();
			}
			const romResMetaList = await progress.runWithDetail('Scan resources', () => getResMetaList(resourceRoots, rom_name, {
				includeCode,
				extraLuaPaths: Array.from(extraLuaPathSet),
				virtualRoot,
				resolveAtlasIndex: true,
			}));
			await progress.taskCompleted();
			// Build resources
			let resources = await progress.runWithDetail('Load resources', () => getResourcesList(romResMetaList));
			await progress.taskCompleted();

			if (GENERATE_AND_USE_TEXTURE_ATLAS) {
				await progress.runWithDetail('Generate atlases', () => createAtlasses(resources, message => progress.setDetail(message)));
			}
			await progress.taskCompleted();

			// Validate AEM references against loaded resources
			validateAudioEventReferences(resources);

			const romAssets = await progress.runWithDetail('Generate ROM assets', () => generateRomAssets(resources, message => progress.setDetail(message)));
			appendProgramAsset(romAssets, romManifest, { includeSymbols: romPackDebug, optLevel });
			stripLuaAssets(romAssets, romPackDebug);
				await progress.taskCompleted();
				if (!isEngineMode) {
					const lintLuaRoots = new Set<string>(extraLuaPathSet);
					lintLuaRoots.add(normalizePathKey(commonResPath));
					await progress.runWithDetail('Lint cart Lua', () => lintCartLuaSources({ roots: Array.from(lintLuaRoots) }));
					await progress.taskCompleted();
				}

			await progress.runWithDetail('Finalize ROM pack', () => finalizeRompack(romAssets, rom_name, { projectRootPath, manifest: romManifest, status: message => progress.setDetail(message), debug: romPackDebug, zipRom: false }));
			await progress.taskCompleted();
		}

		await progress.showDone();
		const romOutput = romOutputPath.length > 0 ? pc.white(romOutputPath) : pc.white('dist/<rom>.rom');
		logOk(`ROM packing complete → ${romOutput}`);
		writeOut(`\n`);
		if (typeCheckError) {
			writeOut(`\n${pc.red('⚠ Build completed with type-check errors')}\n`, 'error');
			throw typeCheckError;
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		const isCompilationFailureReport = typeof message === 'string'
			&& /^Compilation failed with \d+ (?:Lua )?error\(s\):/.test(message);
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
