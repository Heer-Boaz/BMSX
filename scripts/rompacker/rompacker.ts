// IMPORTANT: IMPORTS TO `bmsx/blabla` ARE NOT ALLOWED!!!!!! THIS WILL CAUSE PROBLEMS WITH .GLSL FILES BEING INCLUDED AND THE ROMPACKER CANNOT HANDLE THIS!!!!!

import pc from 'picocolors';
import { Presets, SingleBar } from 'cli-progress';

import { validateAudioEventReferences } from './audioeventvalidator';
import { appendVmProgramAsset, buildBootromScriptIfNewer, buildEngineRuntime, buildGameHtmlAndManifest, buildResourceList, commonResPath, createAtlasses, deployToServer, esbuild, finalizeRompack, GENERATE_AND_USE_TEXTURE_ATLAS, generateRomAssets, getNodeLauncherFilename, getResMetaList, getResourcesList, getRomManifest, isEngineRuntimeRebuildRequired, isRebuildRequired, LUA_CANONICALIZATION, setAtlasFlag, setLuaCanonicalization, typecheckBeforeBuild, typecheckGameWithDts } from './rompacker-core';
import type { RomPackerMode, RomPackerOptions, RomPackerTarget } from './rompacker.rompack';
import type { CanonicalizationType, RomAsset } from '../../src/bmsx/rompack/rompack';
import type { Value } from '../../src/bmsx/vm/cpu';
import { LuaError } from '../../src/bmsx/lua/luaerrors';
import { inflateProgram, decodeProgramAsset, VM_PROGRAM_ASSET_ID } from '../../src/bmsx/vm/vm_program_asset';
import { StringPool } from '../../src/bmsx/vm/string_pool';
import { loadAssetList, normalizeCartridgeBlob } from '../../src/bmsx/rompack/romloader';

import { join, isAbsolute } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// CASE_INSENSITIVE_LUA and its setter are declared earlier in the file to avoid
// temporal-dead-zone issues when they are used during module initialization.

const glyph = {
	info: pc.blue('ℹ'),
	warn: pc.yellow('⚠'),
	error: pc.red('✖'),
	ok: pc.green('✔'),
	arrow: pc.cyan('›'),
	muted: pc.dim('•'),
	title: pc.magenta('◆'),
};
const labelWidth = 14;
type ParsedOptions = RomPackerOptions & { bootloaderFallbackPath?: string; };

const LIBRETRO_CORE_BASENAME = 'bmsx_libretro';
const LIBRETRO_ENTRY_PATH = join(process.cwd(), 'src', 'bmsx_cpp', 'platform', 'libretro', 'libretro_entry.cpp');

async function loadEngineConstPoolSeed(engineRomPath: string): Promise<{ constPool: ReadonlyArray<Value>; stringPool: StringPool }> {
	const romData = await readFile(engineRomPath);
	const { payload } = normalizeCartridgeBlob(romData);
	const { assets } = await loadAssetList(payload);
	const programAsset = assets.find(asset => asset.resid === VM_PROGRAM_ASSET_ID);
	if (!programAsset) {
		throw new Error(`[RomPacker] Engine program asset not found in "${engineRomPath}".`);
	}
	const start = programAsset.start;
	const end = programAsset.end;
	if (start === undefined || end === undefined) {
		throw new Error(`[RomPacker] Engine program asset is missing buffer range in "${engineRomPath}".`);
	}
	const programBytes = new Uint8Array(payload.slice(start, end));
	const decoded = decodeProgramAsset(programBytes);
	const program = inflateProgram(decoded.program);
	return { constPool: program.constPool, stringPool: program.stringPool };
}

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
const OPT_LEVEL_RE = /^-O([0-3])$/;

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
	'ROM PACKING GE-DONUT!! :-)',
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
const romBuildTasks: TaskName[] = [
	'Rom manifest zoekeren en parseren',
	'Game type-checkeren',
	'Game compileren+bundleren',
	'Resource lijst bouwen',
	'Resources laden en metadata genereren',
	'Atlassen puzellen (indien nodig)',
	'Rom-assets genereren',
	'Rompakket finaliseren',
];

// Deployment is handled via `--mode deploy`, not via a rompack pipeline step.

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

function getOptionalParam(args: string[], flag: string, envVar: string): string {
	const value = getParamOrEnv(args, flag, envVar, '');
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

function findExistingDirectory(candidates: Array<string>): string {
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
	const seenFlags = parseArgsVector(args);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag) && !OPT_LEVEL_RE.test(flag));
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
			writeOut(`  --textureatlas <yes|no>  Enable or disable texture atlas (default: yes)`, 'warning');
			writeOut(`  --preserve-lua-case      Disable Lua case folding (default: enabled)`, 'warning');
			writeOut(`  --enginedts <dir>        Use engine declarations from <dir> to type-check the game`, 'warning');
			writeOut(`  --usepkgtsconfig         Use per-game tsconfig.pkg.json for bundling/type-checking`, 'warning');
			writeOut(`  --platform <target>      Target platform: browser (default), cli, headless, libretro, or libretro-win`, 'warning');
			writeOut(`  --mode <rompack|engine|platform|deploy>  What to build (default: rompack)`, 'warning');
			writeOut(`  -O0|-O1|-O2|-O3         VM optimizer level (default: -O3)`, 'warning');
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
	const platformRaw = getParamOrEnv(args, '--platform', 'ROM_PLATFORM', 'browser');
	const platformKey = platformRaw.toLowerCase();
	let platform: RomPackerTarget = platformKey as RomPackerTarget;

	const modeRaw = getParamOrEnv(args, '--mode', 'ROM_MODE', 'rompack');
	const modeStr = modeRaw.toLowerCase();
	let mode: RomPackerMode;
	if (modeStr === 'rompack') {
		mode = 'rompack';
	} else if (modeStr === 'engine') {
		mode = 'engine';
	} else if (modeStr === 'platform') {
		mode = 'platform';
	} else if (modeStr === 'deploy') {
		mode = 'deploy';
	} else {
		throw new Error(`Unsupported --mode "${modeRaw}". Expected one of: rompack, engine, platform, deploy.`);
	}

	const rom_name = getParamOrEnv(args, '-romname', 'ROM_NAME', '');
	const title = getParamOrEnv(args, '-title', 'TITLE', rom_name);
	const defaultBootloaderPath = mode === 'engine'
		? './src/bmsx/console/default_cart'
		: (rom_name ? `./src/${rom_name}` : '');
	let bootloader_path = getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', defaultBootloaderPath);
	const defaultResPath = mode === 'engine'
		? './src/bmsx/res'
		: (rom_name ? `${defaultBootloaderPath}/res` : '');
	let respath = getParamOrEnv(args, '-respath', 'RES_PATH', defaultResPath);

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

	if (mode === 'platform') {
		if (buildreslist) {
			throw new Error('--buildreslist is not compatible with --mode platform.');
		}
		return {
			rom_name,
			title,
			bootloader_path: '',
			respath: '',
			force,
			debug,
			buildreslist: false,
			useTextureAtlas,
			enginedts,
			usePkgTsconfig,
			skipTypecheck,
			platform,
			canonicalization,
			optLevel,
			mode,
			shouldBundleCartCode: false,
			extraLuaRoots: [],
		};
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

	const vmBootloaderPath = normalizePathKey('./src/bmsx/vm/default_cart');
	const bootloaderFile = join(normalizePathKey(bootloader_path), 'bootloader.ts');
	let bootloaderFallbackApplied = false;
	if (!existsSync(bootloaderFile)) {
		bootloader_path = vmBootloaderPath;
		bootloaderFallbackApplied = true;
	}
	const bootloaderFallbackPath = bootloaderFallbackApplied ? vmBootloaderPath : undefined;

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
			platform,
			canonicalization,
			optLevel,
			mode,
			shouldBundleCartCode,
			extraLuaRoots,
			bootloaderFallbackPath,
		};
	}

function writeOut(_tolog: string, type?: logentryType): void {
	let tolog = _tolog;
	if (type === 'error') tolog = pc.red(_tolog);
	else if (type === 'warning') tolog = pc.yellow(_tolog);
	process.stdout.write(tolog);
}

function clearScreen(): void {
	if (process.stdout.isTTY) {
		console.clear();
	}
}

function printBanner(): void {
	clearScreen();
	writeOut(pc.bold(pc.green('╔════════════════════════════════════════════════════════════════════════════════╗\n')));
	writeOut(pc.bold(pc.green(`║  ${' '.repeat(25)}${pc.white('BMSX ROMPACKER')} by Boaz©®℗™${' '.repeat(27)}║\n`)));
	writeOut(pc.bold(pc.green('╚════════════════════════════════════════════════════════════════════════════════╝\n')));
}

function logInfo(message: string): void {
	writeOut(`${glyph.info} ${message}\n`);
}

function logWarn(message: string): void {
	writeOut(`${glyph.warn} ${message}\n`, 'warning');
}

function logOk(message: string): void {
	writeOut(`${glyph.ok} ${message}\n`);
}

function logBullet(label: string, value: string): void {
	const padded = label.padEnd(labelWidth, ' ');
	writeOut(`${glyph.arrow} ${pc.bold(padded)} ${pc.dim('·')} ${value}\n`);
}

function logDivider(title: string): void {
	writeOut(`\n${glyph.title} ${pc.bold(title)}\n`);
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
				const nmsg = note.text ?? '';
				if (nmsg) result.push(nlocStr ? `  note: ${nlocStr}: ${nmsg}` : `  note: ${nmsg}`);
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

function runCommand(command: string, args: string[]): void {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(' ')}`);
	}
}

function getLibretroBuildDir(platform: RomPackerTarget, debug: boolean): string {
	const base = platform === 'libretro-win' ? 'build-win' : 'build';
	return debug ? `${base}-debug` : `${base}-release`;
}

function getLibretroBuildOutputPath(platform: RomPackerTarget, debug: boolean): string {
	const buildDir = getLibretroBuildDir(platform, debug);
	const coreFilename = getLibretroCoreFilename(platform);
	if (platform === 'libretro-win') {
		const configDir = debug ? 'Debug' : 'Release';
		return join(process.cwd(), buildDir, configDir, coreFilename);
	}
	return join(process.cwd(), buildDir, coreFilename);
}

function findCMake(): string {
	try {
		const result = spawnSync('cmake', ['--version']);
		if (result.status === 0) return 'cmake';
	} catch { }

	// Try to find via vswhere
	try {
		const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
		const args = ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.CMake.Project', '-property', 'installationPath'];
		const result = spawnSync(vswhere, args, { encoding: 'utf8' });
		if (result.status === 0 && result.stdout) {
			const installPath = result.stdout.trim();
			if (installPath) {
				// Search for cmake.exe recursively in the installation path to avoid hardcoding internal paths
				try {
					const { execSync } = require('child_process');
					// Use dir /S /B to find cmake.exe
					const stdout = execSync(`dir /S /B cmake.exe`, { cwd: installPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
					const lines = stdout.split(/\r?\n/);
					// Prefer the one in a 'bin' directory
					const found = lines.find(line => line.trim().toLowerCase().endsWith('bin\\cmake.exe'));
					if (found) return found.trim();
				} catch { }
			}
		}
	} catch { }

	return 'cmake'; // Fallback
}

function ensureLibretroCoreBuilt(debug: boolean, platform: RomPackerTarget): void {
	const cmakeBin = findCMake();
	const buildType = debug ? 'Debug' : 'Release';
	const buildDir = getLibretroBuildDir(platform, debug);
	logInfo(`Using build dir ${pc.white(buildDir)} (${buildType})`);
	const cmakeArgs = ['-S', 'src/bmsx_cpp', '-B', buildDir, `-DCMAKE_BUILD_TYPE=${buildType}`, '-DBMSX_BUILD_LIBRETRO=ON', '-DBMSX_BUILD_LIBRETRO_HOST=OFF'];
	if (platform === 'libretro-wsl') {
		cmakeArgs.push('-DCMAKE_CXX_STANDARD=20');
	}
	if (platform === 'libretro-win') {
		if (process.platform !== 'win32') {
			throw new Error('libretro-win requires running on Windows with MSVC build tools.');
		}
		// Let CMake pick the latest Visual Studio version installed
		// cmakeArgs.push('-G', 'Visual Studio 17 2022', '-A', 'x64');
		cmakeArgs.push('-A', 'x64');
	}
	runCommand(cmakeBin, cmakeArgs);
	const config = debug ? 'Debug' : 'Release';
	runCommand(cmakeBin, ['--build', buildDir, '--config', config]);
}

function getLibretroCoreFilename(platform: RomPackerTarget): string {
	const suffix = platform === 'libretro-win' ? '.dll' : '.so';
	return `${LIBRETRO_CORE_BASENAME}${suffix}`;
}

function extractLibretroConstant(source: string, constantName: string): string {
	const matcher = new RegExp(`\\b${constantName}\\b\\s*=\\s*"([^"]+)"`);
	const match = source.match(matcher);
	if (!match) {
		throw new Error(`Libretro constant "${constantName}" was not found in ${LIBRETRO_ENTRY_PATH}.`);
	}
	return match[1];
}

async function stageLibretroArtifacts(platform: RomPackerTarget, debug: boolean): Promise<void> {
	const libretroEntrySource = await readFile(LIBRETRO_ENTRY_PATH, 'utf8');
	const coreName = extractLibretroConstant(libretroEntrySource, 'CORE_NAME');
	const coreVersion = extractLibretroConstant(libretroEntrySource, 'CORE_VERSION');
	const supportedExtensions = extractLibretroConstant(libretroEntrySource, 'VALID_EXTENSIONS');

	const distDir = join(process.cwd(), 'dist');
	const coreFilename = getLibretroCoreFilename(platform);
	const coreSrc = getLibretroBuildOutputPath(platform, debug);
	const coreDst = join(distDir, coreFilename);
	const infoDst = join(distDir, `${LIBRETRO_CORE_BASENAME}.info`);

	await mkdir(distDir, { recursive: true });
	await copyFile(coreSrc, coreDst);

	const infoContents = [
		`display_name = "${coreName}"`,
		`display_version = "${coreVersion}"`,
		`corename = "${coreName}"`,
		`supported_extensions = "${supportedExtensions}"`,
		`supports_no_game = "true"`,
	].join('\n') + '\n';
	await writeFile(infoDst, infoContents, 'utf8');
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
		return this.tasks[0] ?? '';
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
		const finishedTask = this.tasks.shift() ?? '';
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

async function runPlatformBuild(options: ParsedOptions): Promise<void> {
	const { platform, canonicalization, debug, force } = options;

	logDivider('Platform');
	logBullet('Platform', pc.cyan(platform));
	logBullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));

	if (platform.startsWith('libretro')) {
		logInfo('Building libretro core');
		ensureLibretroCoreBuilt(debug, platform);
		logInfo('Staging libretro core');
		await stageLibretroArtifacts(platform, debug);
		const stagedName = getLibretroCoreFilename(platform);
		logOk(`Libretro core staged → ${pc.white(`dist/${stagedName}`)}`);
		return;
	}

	logInfo('Building platform artifacts');
	await buildBootromScriptIfNewer({ debug, forceBuild: force, platform, canonicalization });
	logOk('Boot ROM ready');

	if (platform === 'browser') {
		await buildGameHtmlAndManifest('', 'BMSX', 'BMSX', debug, false);
		logOk(`Browser loader → ${pc.white('dist/index.html')}`);
		logOk(`Manifest → ${pc.white('dist/manifest.webmanifest')}`);
	} else {
		const launcherName = getNodeLauncherFilename(platform, debug);
		logOk(`Node launcher → ${pc.white(`dist/${launcherName}`)}`);
	}
	logOk(`Platform build complete → ${pc.cyan(platform)}`);
}

async function runBrowserDeploy(options: ParsedOptions): Promise<void> {
	const { platform, canonicalization, debug, force, respath, title: cliTitle, rom_name: cliRomName } = options;
	if (platform !== 'browser') {
		throw new Error('--mode deploy is only supported with --platform browser.');
	}
	if (!cliRomName || cliRomName.length === 0) {
		throw new Error('--mode deploy requires -romname <cart-folder>.');
	}
	if (!respath || respath.length === 0) {
		throw new Error('--mode deploy requires a resolved -respath (expected "./src/<cart>/res").');
	}

	const romManifest = await getRomManifest(respath);
	if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);

	const romName = romManifest.rom_name ?? cliRomName;
	const resolvedTitle = romManifest.title ?? cliTitle ?? 'BMSX';
	const short_name = romManifest.short_name ?? 'BMSX';

	const expectedRomOutput = join(process.cwd(), 'dist', `${romName}${debug ? '.debug' : ''}.rom`);
	if (!existsSync(expectedRomOutput)) {
		throw new Error(`Deploy requires a built ROMPACK at "${expectedRomOutput}". Run the ROMPACK build first.`);
	}

	logDivider('Deploy (browser)');
	logBullet('ROM', pc.bold(pc.white(romName)));
	logBullet('Title', pc.white(resolvedTitle));
	logBullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));

	await buildBootromScriptIfNewer({ debug, forceBuild: force, platform, canonicalization });
	await buildGameHtmlAndManifest(romName, resolvedTitle, short_name, debug, true);
	logOk(`Browser loader → ${pc.white('dist/index.html')}`);
	logOk(`Manifest → ${pc.white('dist/manifest.webmanifest')}`);
	logOk('Deploy build complete');
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

	const engineRuntimeOut = debug ? './dist/engine.debug.js' : './dist/engine.js';
	const runtimeNeedsRebuild = force || await isEngineRuntimeRebuildRequired(engineRuntimeOut);
	if (runtimeNeedsRebuild) {
		logInfo('Build engine runtime');
		await buildEngineRuntime({ debug });
		logOk(`Engine runtime ready → ${pc.white(engineRuntimeOut.replace('./dist/', 'dist/'))}`);
	}

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
	const engineCanonicalization = engineManifest.vm.canonicalization ?? previousCanonicalization;
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
		}
		validateAudioEventReferences(engineResources);
		const engineRomAssets = await generateRomAssets(engineResources);
		appendVmProgramAsset(engineRomAssets, engineManifest, { includeSymbols: debug, optLevel });
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

		let { title, rom_name, bootloader_path, respath, force, debug, buildreslist, useTextureAtlas, enginedts, usePkgTsconfig, skipTypecheck, canonicalization, optLevel, mode, shouldBundleCartCode, extraLuaRoots, bootloaderFallbackPath, platform } = options;

		if (mode === 'platform') {
			await runPlatformBuild(options);
			writeOut('\n');
			return;
		}
			if (mode === 'deploy') {
				await runBrowserDeploy(options);
				writeOut('\n');
				return;
			}
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
		let short_name: string = romManifest.short_name ?? 'BMSX';
		romOutputPath = `dist/${rom_name}${romPackDebug ? '.debug' : ''}.rom`;

		logDivider('Run setup');
		logBullet('ROM', pc.bold(pc.white(rom_name)));
		logBullet('Title', pc.white(title));
		logBullet('Mode', pc.magenta(mode));
		logBullet('Platform', pc.cyan(platform));
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
			logBullet('VM opt', pc.white(`-O${optLevel}`));

			const includeCode = shouldBundleCartCode;

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
			}
			await progress.taskCompleted();
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
				appendVmProgramAsset(romAssets, romManifest, { includeSymbols: romPackDebug, optLevel });
				stripLuaAssets(romAssets, romPackDebug);
				await progress.taskCompleted();

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
		if (progress) {
			progress.stop();
			await progress.pulse();
			const failedTask = progress.getCurrentTask();
			const summary = e instanceof LuaError
				? `${resolveLuaSourcePath(e.path, luaErrorVirtualRoots)}:${e.line}:${e.column}: ${e.message}`
				: (e as any)?.message?.split?.('\n')?.[0] ?? String(e);
			if (failedTask) {
				progress.fail(failedTask, summary);
				writeOut(`${pc.red(`✘ Failed during: ${failedTask}`)}`, 'error');
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
				prettyErrors.push(...lines);
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
