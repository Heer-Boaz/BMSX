import pc from 'picocolors';
import { stat, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { runPlatformBuild } from './platformbuild';
import { getNodeLauncherFilename } from './rombuilder';
import type { RomPackerTarget } from './rompacker.rompack';
import type { CanonicalizationType } from '../../src/bmsx/rompack/rompack';

import { createCliUi, getParamOrEnv, parseArgsVector } from './cli_shared';

const KNOWN_FLAGS = new Set<string>([
	'--debug',
	'--force',
	'--platform',
	'--preserve-lua-case',
	'-h',
	'--help',
]);

const FLAGS_WITH_VALUES = new Set<string>([
	'--platform',
]);

const ui = createCliUi({ bannerTitle: 'BMSX PLATFORM BUILDER', labelWidth: 14 });

const PLATFORM_REBUILD_FILE_EXTENSIONS = new Set<string>([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.json',
	'.glsl',
	'.css',
	'.html',
	'.xml',
	'.lua',
]);

const PLATFORM_REBUILD_SKIP_DIRS = new Set<string>([
	'_ignore',
	'node_modules',
	'.git',
	'.svn',
	'.hg',
	'dist',
	'build',
	'out',
	'.cache',
	'.bmsx',
]);

type ParsedPlatformOptions = {
	platform: RomPackerTarget;
	debug: boolean;
	force: boolean;
	canonicalization: CanonicalizationType;
};

async function getMtimeMs(path: string): Promise<number> {
	try {
		const fileStats = await stat(path);
		return fileStats.mtimeMs;
	} catch {
		return 0;
	}
}

async function getNewestInputMtimeMs(path: string): Promise<number> {
	let pathStats;
	try {
		pathStats = await stat(path);
	} catch {
		return 0;
	}

	if (pathStats.isFile()) {
		const ext = extname(path).toLowerCase();
		return PLATFORM_REBUILD_FILE_EXTENSIONS.has(ext) ? pathStats.mtimeMs : 0;
	}
	if (!pathStats.isDirectory()) {
		return 0;
	}

	let newest = 0;
	const entries = await readdir(path, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory() && PLATFORM_REBUILD_SKIP_DIRS.has(entry.name.toLowerCase())) {
			continue;
		}
		const entryPath = join(path, entry.name);
		if (entry.isDirectory()) {
			const entryNewest = await getNewestInputMtimeMs(entryPath);
			if (entryNewest > newest) {
				newest = entryNewest;
			}
			continue;
		}
		const ext = extname(entry.name).toLowerCase();
		if (!PLATFORM_REBUILD_FILE_EXTENSIONS.has(ext)) {
			continue;
		}
		const entryMtime = await getMtimeMs(entryPath);
		if (entryMtime > newest) {
			newest = entryMtime;
		}
	}
	return newest;
}

function resolvePlatformArtifactPath(platform: RomPackerTarget, debug: boolean): string {
	if (platform === 'browser') {
		return join(process.cwd(), 'rom', 'bootrom.js');
	}
	if (platform === 'headless' || platform === 'cli') {
		return join(process.cwd(), 'dist', getNodeLauncherFilename(platform, debug));
	}
	return '';
}

function resolvePlatformDependencyRoots(platform: RomPackerTarget): string[] {
	if (platform !== 'browser' && platform !== 'headless' && platform !== 'cli') {
		return [];
	}
	return [
		join(process.cwd(), 'scripts', 'bootrom'),
		join(process.cwd(), 'src', 'bmsx_hostplatform'),
		join(process.cwd(), 'src', 'bmsx', 'platform'),
	];
}

async function shouldForceRebuildForPlatformSources(options: ParsedPlatformOptions): Promise<boolean> {
	if (options.force) {
		return false;
	}
	const artifactPath = resolvePlatformArtifactPath(options.platform, options.debug);
	if (!artifactPath) {
		return false;
	}
	const artifactMtime = await getMtimeMs(artifactPath);
	if (artifactMtime === 0) {
		return true;
	}
	const dependencyRoots = resolvePlatformDependencyRoots(options.platform);
	let newestInputMtime = 0;
	for (const root of dependencyRoots) {
		const rootNewest = await getNewestInputMtimeMs(root);
		if (rootNewest > newestInputMtime) {
			newestInputMtime = rootNewest;
		}
	}
	return newestInputMtime > artifactMtime;
}

function parseOptions(args: string[]): ParsedPlatformOptions {
	const seenFlags = parseArgsVector(args, FLAGS_WITH_VALUES);
	const unknownFlags = [...seenFlags].filter(flag => !KNOWN_FLAGS.has(flag));
	if (unknownFlags.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unknownFlags.join(', ')}`);
	}

	if (seenFlags.has('-h') || seenFlags.has('--help')) {
		ui.writeOut('Usage: <command> [options]\n', 'warning');
		ui.writeOut('Options:\n', 'warning');
		ui.writeOut('  --platform <target>       Target platform: browser (default), cli, headless, libretro-wsl, libretro-win\n', 'warning');
		ui.writeOut('  --debug                   Build debug artifacts\n', 'warning');
		ui.writeOut('  --force                   Force rebuild\n', 'warning');
		ui.writeOut('  --preserve-lua-case       Disable Lua case folding for bootrom canonicalization\n', 'warning');
		process.exit(0);
	}

	const debug = seenFlags.has('--debug');
	const force = seenFlags.has('--force');
	const platformRaw = getParamOrEnv(args, '--platform', 'ROM_PLATFORM', 'browser', KNOWN_FLAGS);
	const platform = platformRaw.toLowerCase() as RomPackerTarget;

	const preserveLuaCase = seenFlags.has('--preserve-lua-case');
	const canonicalizationEnv = process.env.ROM_LUA_CANONICALIZATION;
	let canonicalization: CanonicalizationType = 'lower';
	if (canonicalizationEnv && canonicalizationEnv.length > 0) {
		if (canonicalizationEnv === 'none' || canonicalizationEnv === 'lower' || canonicalizationEnv === 'upper') {
			canonicalization = canonicalizationEnv;
		} else {
			throw new Error(`Unsupported value "${canonicalizationEnv}" for ROM_LUA_CANONICALIZATION. Expected one of: 'none', 'lower', 'upper'.`);
		}
	} else if (preserveLuaCase) {
		canonicalization = 'none';
	}

	return {
		platform,
		debug,
		force,
		canonicalization,
	};
}

async function main(): Promise<void> {
	ui.printBanner();
	let options = parseOptions(process.argv.slice(2));
	if (await shouldForceRebuildForPlatformSources(options)) {
		ui.warn('Platform sources are newer than platform artifact; enabling forced rebuild.');
		options = {
			...options,
			force: true,
		};
	}
	const logger = {
		divider: ui.divider,
		bullet: ui.bullet,
		info: ui.info,
		ok: ui.ok,
	};
	await runPlatformBuild(options, logger);
	ui.writeOut('\n');
}

main().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	ui.writeOut(`${pc.red(message)}\n`);
	process.exit(1);
});
