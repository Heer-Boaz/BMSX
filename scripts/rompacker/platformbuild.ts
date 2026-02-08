import pc from 'picocolors';

import {
	buildBootromScriptIfNewer,
	buildEngineRuntime,
	buildGameHtmlAndManifest,
	getNodeLauncherFilename,
	getRomManifest,
	isEngineRuntimeRebuildRequired,
} from './rombuilder';
import type { RomPackerOptions, RomPackerTarget } from './rompacker.rompack';

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export interface BuilderLogger {
	divider(title: string): void;
	bullet(label: string, value: string): void;
	info(message: string): void;
	ok(message: string): void;
}

type PlatformBuildOptions = Pick<RomPackerOptions, 'platform' | 'canonicalization' | 'debug' | 'force'>;
type BrowserDeployOptions = Pick<RomPackerOptions, 'platform' | 'canonicalization' | 'debug' | 'force' | 'respath' | 'title' | 'rom_name'>;

const LIBRETRO_CORE_BASENAME = 'bmsx_libretro';
const LIBRETRO_ENTRY_PATH = join(process.cwd(), 'src', 'bmsx_cpp', 'platform', 'libretro', 'libretro_entry.cpp');

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

function getLibretroCoreFilename(platform: RomPackerTarget): string {
	const suffix = platform === 'libretro-win' ? '.dll' : '.so';
	return `${LIBRETRO_CORE_BASENAME}${suffix}`;
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

	try {
		const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
		const args = ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.CMake.Project', '-property', 'installationPath'];
		const result = spawnSync(vswhere, args, { encoding: 'utf8' });
		if (result.status === 0 && result.stdout) {
			const installPath = result.stdout.trim();
			if (installPath) {
				try {
					const { execSync } = require('child_process');
					const stdout = execSync('dir /S /B cmake.exe', { cwd: installPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
					const lines = stdout.split(/\r?\n/);
					const found = lines.find(line => line.trim().toLowerCase().endsWith('bin\\cmake.exe'));
					if (found) return found.trim();
				} catch { }
			}
		}
	} catch { }

	return 'cmake';
}

function ensureLibretroCoreBuilt(debug: boolean, platform: RomPackerTarget, logger: BuilderLogger): void {
	const cmakeBin = findCMake();
	const buildType = debug ? 'Debug' : 'Release';
	const buildDir = getLibretroBuildDir(platform, debug);
	logger.info(`Using build dir ${pc.white(buildDir)} (${buildType})`);
	const cmakeArgs = ['-S', 'src/bmsx_cpp', '-B', buildDir, `-DCMAKE_BUILD_TYPE=${buildType}`, '-DBMSX_BUILD_LIBRETRO=ON', '-DBMSX_BUILD_LIBRETRO_HOST=OFF'];
	if (platform === 'libretro-wsl') {
		cmakeArgs.push('-DCMAKE_CXX_STANDARD=20');
	}
	if (platform === 'libretro-win') {
		if (process.platform !== 'win32') {
			throw new Error('libretro-win requires running on Windows with MSVC build tools.');
		}
		cmakeArgs.push('-A', 'x64');
	}
	runCommand(cmakeBin, cmakeArgs);
	const config = debug ? 'Debug' : 'Release';
	runCommand(cmakeBin, ['--build', buildDir, '--config', config]);
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

export async function runPlatformBuild(options: PlatformBuildOptions, logger: BuilderLogger): Promise<void> {
	const { platform, canonicalization, debug, force } = options;

	logger.divider('Platform');
	logger.bullet('Platform', pc.cyan(platform));
	logger.bullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));

	if (platform.startsWith('libretro')) {
		logger.info('Building libretro core');
		ensureLibretroCoreBuilt(debug, platform, logger);
		logger.info('Staging libretro core');
		await stageLibretroArtifacts(platform, debug);
		const stagedName = getLibretroCoreFilename(platform);
		logger.ok(`Libretro core staged → ${pc.white(`dist/${stagedName}`)}`);
		return;
	}

	if (platform === 'browser' || platform === 'headless') {
		const engineRuntimeOut = debug ? './dist/engine.debug.js' : './dist/engine.js';
		const runtimeNeedsRebuild = force || await isEngineRuntimeRebuildRequired(engineRuntimeOut);
		if (runtimeNeedsRebuild) {
			logger.info('Build engine runtime');
			await buildEngineRuntime({ debug });
			logger.ok(`Engine runtime ready → ${pc.white(engineRuntimeOut.replace('./dist/', 'dist/'))}`);
		}
	}

	logger.info('Building platform artifacts');
	await buildBootromScriptIfNewer({ debug, forceBuild: force, platform, canonicalization });
	logger.ok('Boot ROM ready');

	if (platform === 'browser') {
		await buildGameHtmlAndManifest('', 'BMSX', 'BMSX', debug, false);
		logger.ok(`Browser loader → ${pc.white('dist/index.html')}`);
		logger.ok(`Manifest → ${pc.white('dist/manifest.webmanifest')}`);
	} else {
		const launcherName = getNodeLauncherFilename(platform, debug);
		logger.ok(`Node launcher → ${pc.white(`dist/${launcherName}`)}`);
	}
	logger.ok(`Platform build complete → ${pc.cyan(platform)}`);
}

export async function runBrowserDeploy(options: BrowserDeployOptions, logger: BuilderLogger): Promise<void> {
	const { platform, canonicalization, debug, force, respath, title: cliTitle, rom_name: cliRomName } = options;
	if (platform !== 'browser') {
		throw new Error('Deploy only supports platform "browser".');
	}
	if (!cliRomName || cliRomName.length === 0) {
		throw new Error('Deploy requires -romname <cart-folder>.');
	}
	if (!respath || respath.length === 0) {
		throw new Error('Deploy requires a resolved -respath (expected "./src/<cart>/res").');
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

	logger.divider('Deploy (browser)');
	logger.bullet('ROM', pc.bold(pc.white(romName)));
	logger.bullet('Title', pc.white(resolvedTitle));
	logger.bullet('Debug', debug ? pc.green('enabled') : pc.dim('disabled'));

	const engineRuntimeOut = debug ? './dist/engine.debug.js' : './dist/engine.js';
	const runtimeNeedsRebuild = force || await isEngineRuntimeRebuildRequired(engineRuntimeOut);
	if (runtimeNeedsRebuild) {
		logger.info('Build engine runtime');
		await buildEngineRuntime({ debug });
		logger.ok(`Engine runtime ready → ${pc.white(engineRuntimeOut.replace('./dist/', 'dist/'))}`);
	}

	await buildBootromScriptIfNewer({ debug, forceBuild: force, platform, canonicalization });
	await buildGameHtmlAndManifest(romName, resolvedTitle, short_name, debug, true);
	logger.ok(`Browser loader → ${pc.white('dist/index.html')}`);
	logger.ok(`Manifest → ${pc.white('dist/manifest.webmanifest')}`);
	logger.ok('Deploy build complete');
}
