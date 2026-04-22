// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE BUILDER CANNOT HANDLE THIS!!!!!

import pc from 'picocolors';
import { Presets, SingleBar } from 'cli-progress';

import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_ROM_NAME } from '../../src/bmsx/core/system';
import { createCliUi, findExistingDirectory, getParamOrEnv, normalizePathKey, parseArgsVector } from './cli';
import { validateAudioEventReferences } from './audioeventvalidator';
import { lintCartSources } from './cart_lua_linter_runtime';
import { appendProgramAsset, commonResPath, createAtlasses, finalizeRompack, GENERATE_AND_USE_TEXTURE_ATLAS, generateRomAssets, getResMetaList, getResourcesList, getRomManifest, isRebuildRequired, setAtlasFlag } from './rombuilder';
import type { RomPackerOptions } from './formater.rompack';
import type { RomAsset } from '../../src/bmsx/rompack/format';
import { LuaError } from '../../src/bmsx/lua/errors';

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
	'--textureatlas',
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
	'--textureatlas',
]);
const OPT_LEVEL_RE = /^-O([0-3])$/;

const TASK = {
	REBUILD_CHECK: 'Checken of rebuild nodig is',
	MANIFEST_SCAN: 'Rom manifest zoekeren en parseren',
	CART_LUA_LINT: 'Cart Lua linten',
	RESOURCE_LIST: 'Resources scannen',
	RESOURCE_LOAD: 'Resources laden en metadata genereren',
	ATLAS_BUILD: 'Atlassen puzellen (indien nodig)',
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

// --- Individual lists that allow us to easily remove tasks from the main task list (visualisation only!) ---
const romBuildTasks: TaskName[] = taskList.slice(1, -1);

const biosBuildTasks: TaskName[] = [
	TASK.BIOS_REBUILD_CHECK,
	TASK.BIOS_LINT,
	TASK.MANIFEST_SCAN,
	TASK.RESOURCE_LIST,
	TASK.ATLAS_BUILD,
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
		normalizedRomName ? `./src/carts/${normalizedRomName}` : undefined,
		romLeaf && romLeaf !== normalizedRomName ? `./src/carts/${romLeaf}` : undefined,
	];
	const cartRoot = findExistingDirectory(cartCandidates);
	if (!cartRoot) {
		const attempted = cartCandidates.filter(Boolean).map(normalizePathKey).join(', ');
		throw new Error(`Cart folder "${romName}" not found under src/carts. Tried: ${attempted || '<none>'}.`);
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
		writeOut(`  -romname <name>          Cart folder under src/carts (required for rompack mode)\n`, 'warning');
		writeOut(`  -title <title>           Title override\n`, 'warning');
		writeOut(`  -bootloaderpath <path>   BIOS-only bootloader path override\n`, 'warning');
		writeOut(`  -respath <path>          Resource path override\n`, 'warning');
		writeOut(`  --debug                  Build debug artifacts\n`, 'warning');
		writeOut(`  --force                  Force the compilation and build of the rompack\n`, 'warning');
		writeOut(`  --textureatlas <yes|no>  Enable or disable texture atlas (default: yes)\n`, 'warning');
		writeOut(`  --mode <rompack|bios>  What to build (default: rompack)\n`, 'warning');
		writeOut(`  -O0|-O1|-O2|-O3          Bytecode optimizer level (default: -O3)\n`, 'warning');
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
	const defaultBootloaderPath = './src/bmsx/machine/firmware/default_cart';
	let bootloader_path = getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', defaultBootloaderPath, KNOWN_FLAGS);
	const respathOverride = getOptionalParam(args, '-respath', 'RES_PATH');
	let respath = mode === 'bios' ? './src/bmsx/res' : '';

	let extraLuaRoots: string[] = [];
	if (mode === 'bios') {
		respath = getParamOrEnv(args, '-respath', 'RES_PATH', './src/bmsx/res', KNOWN_FLAGS);
		bootloader_path = normalizePathKey(bootloader_path);
		respath = normalizePathKey(respath);
	} else {
		if (!rom_name && !respathOverride) {
			throw new Error('Rompack mode requires -romname <cart-folder> or -respath <cart-respath>.');
		}
		if (seenFlags.has('-bootloaderpath')) {
			throw new Error('Rompack mode no longer supports -bootloaderpath. Carts always boot through src/bmsx/machine/firmware/default_cart.');
		}
		const resolvedCart = resolveCartResPath(rom_name, respathOverride);
		bootloader_path = normalizePathKey(defaultBootloaderPath);
		respath = resolvedCart.respath;
		extraLuaRoots = [resolvedCart.cartRoot];
	}

	return {
		rom_name,
		title,
		bootloader_path,
		respath,
		force,
		debug,
		useTextureAtlas,
		skipTypecheck,
		platform: 'browser',
		optLevel,
		mode,
		shouldBundleCartCode: false,
		extraLuaRoots,
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

async function runBIOSBuild(options: ParsedOptions, progress?: ProgressReporter): Promise<void> {
	const { respath, bootloader_path, force, debug, optLevel, useTextureAtlas } = options;

	setAtlasFlag(useTextureAtlas);

	const BIOSResPath = respath || commonResPath;
	if (!BIOSResPath) {
		throw new Error('Missing BIOS respath (expected ./src/bmsx/res).');
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
			extraLuaPaths: [],
			resolveAtlasIndex: false,
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
			progress.suspend();
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
	const biosLuaRoots = [normalizePathKey(BIOSResPath)];
	await runBIOSStep(TASK.BIOS_LINT, () => lintCartSources({ roots: biosLuaRoots, profile: 'bios' }));

	const BIOSResMetaList = await runBIOSStep(TASK.MANIFEST_SCAN, () => getResMetaList([BIOSResPath], BIOSRomName, {
		extraLuaPaths: [],
		virtualRoot: BIOSVirtualRoot,
		resolveAtlasIndex: true,
	}));
	const BIOSResources = await runBIOSStep(TASK.RESOURCE_LIST, () => getResourcesList(BIOSResMetaList));
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		await runBIOSStep(TASK.ATLAS_BUILD, () => createAtlasses(BIOSResources));
	} else if (progress) {
		progress.skipTasks(1);
	}
	validateAudioEventReferences(BIOSResources);
	const BIOSRomAssets = await runBIOSStep(TASK.ROM_ASSETS, () => generateRomAssets(BIOSResources, message => progress?.setDetail(message)));
	const BIOSProgramBoot = appendProgramAsset(BIOSRomAssets, SYSTEM_BOOT_ENTRY_PATH, { includeSymbols: true, optLevel });
	stripLuaAssets(BIOSRomAssets, debug);
	await runBIOSStep(TASK.BIOS_FINALIZE, () => finalizeRompack(BIOSRomAssets, BIOSRomName, { projectRootPath: '', manifest: null, zipRom: false, debug, programBoot: BIOSProgramBoot }));
	if (progress) {
		await progress.showDone();
		progress.suspend();
	}
	logOk(`BIOS assets ready → ${pc.white(`dist/${BIOSRomName}${debug ? '.debug' : ''}.rom`)}`);
}

async function main() {
	let progress: ProgressReporter;
	let romOutputPath = '';
	let luaErrorVirtualRoots: string[] = [];
	const bufferedLogs: string[] = [];
	try {
		printBanner();

		const args = process.argv.slice(2);
		const options = parseOptions(args);

		let { title, rom_name, bootloader_path, respath, force, debug, useTextureAtlas, optLevel, mode, extraLuaRoots } = options;

		if (mode === 'bios') {
			progress = new ProgressReporter(biosBuildTasks);
			await runBIOSBuild(options, progress);
			writeOut('\n');
			return;
		}

		progress = new ProgressReporter(taskList);
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

		setAtlasFlag(useTextureAtlas);

		const resourceRoots = isBIOSMode
			? [respath || commonResPath]
			: [respath || commonResPath, commonResPath];
		const extraLuaPathSet = new Set<string>(extraLuaRoots.map(normalizePathKey));

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

		logDivider('Options');
		logBullet('Rebuild', force ? pc.yellow('force') : pc.green('auto (mtime check)'));
		logBullet('Atlas', useTextureAtlas ? pc.green('enabled') : pc.red('disabled'));
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
			rebuildRequired = await progress.runWithDetail('Check timestamps', () => isRebuildRequired(rom_name, bootloader_path, respath, { extraLuaPaths: Array.from(extraLuaPathSet), resolveAtlasIndex: false, debug }));
			if (!rebuildRequired && resourceRoots.length > 1) {
				for (let i = 1; i < resourceRoots.length; i++) {
					const candidate = resourceRoots[i];
					if (!candidate || candidate === respath) continue;
					const needs = await progress.runWithDetail('Check timestamps (shared)', () => isRebuildRequired(rom_name, bootloader_path, candidate, { extraLuaPaths: Array.from(extraLuaPathSet), resolveAtlasIndex: true, debug }));
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
			const programBoot = appendProgramAsset(romAssets, romManifest.lua.entry_path, { includeSymbols: true, optLevel });
			stripLuaAssets(romAssets, romPackDebug);
			await progress.taskCompleted();
			if (!isBIOSMode) {
				const cartLuaRoots = Array.from(extraLuaPathSet);
				const biosLuaRoots = [normalizePathKey(commonResPath)];
				await progress.runWithDetail('Lint cart + BIOS Lua', async () => {
					await lintCartSources({ roots: cartLuaRoots, profile: 'cart' });
					await lintCartSources({ roots: biosLuaRoots, profile: 'bios' });
				});
				await progress.taskCompleted();
			}

			await progress.runWithDetail('Finalize ROM pack', () => finalizeRompack(romAssets, rom_name, { projectRootPath, manifest: romManifest, status: message => progress.setDetail(message), debug: romPackDebug, zipRom: false, programBoot }));
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
