import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { runPlatformBuild } from './platformbuild';
import type { BuilderLogger } from './platformbuild';
import { getBrowserHostFilename, getNodeLauncherFilename } from './rombuilder';
import type { RomPackerTarget } from './rompacker.rompack';
import { collectSourceFiles } from '../analysis/file_scan';

import { getParamOrEnv, parseArgsVector } from './cli';
import { createCliUi } from './display';
import type { TaskProgressReporter } from './progress';

const KNOWN_FLAGS = new Set<string>([
	'--debug',
	'--force',
	'--platform',
	'-h',
	'--help',
]);

const TASK = {
	HOST_SYSTEM_ATLAS: 'Build host system atlas',
	MACHINE_RUNTIME: 'Build machine runtime',
	BROWSER_HOST: 'Build browser host',
	PLATFORM_ARTIFACTS: 'Build platform artifacts',
} as const;

type TaskName = typeof TASK[keyof typeof TASK];

function getPlatformTaskList(platform: RomPackerTarget): TaskName[] {
	const tasks: TaskName[] = [
		TASK.HOST_SYSTEM_ATLAS,
	];
	if (platform === 'browser' || platform === 'headless' || platform === 'cli') {
		tasks.push(TASK.MACHINE_RUNTIME);
	}
	if (platform === 'browser') {
		tasks.push(TASK.BROWSER_HOST);
	}
	tasks.push(TASK.PLATFORM_ARTIFACTS);
	return tasks;
}

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

type ParsedPlatformOptions = {
	platform: RomPackerTarget;
	debug: boolean;
	force: boolean;
};

async function getMtimeMs(path: string): Promise<number> {
	const fileStats = await stat(path);
	return fileStats.mtimeMs;
}

async function getNewestInputMtimeMs(path: string): Promise<number> {
	let newest = 0;
	const files = collectSourceFiles([path], PLATFORM_REBUILD_FILE_EXTENSIONS);
	for (const file of files) {
		const entryMtime = await getMtimeMs(file);
		if (entryMtime > newest) {
			newest = entryMtime;
		}
	}
	return newest;
}

function resolvePlatformArtifactPath(platform: RomPackerTarget, debug: boolean): string {
	if (platform === 'browser') {
		return join(process.cwd(), 'dist', getBrowserHostFilename(debug));
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
	const roots = [
		join(process.cwd(), 'scripts', 'rompacker'),
		join(process.cwd(), 'scripts', 'bootrom'),
		join(process.cwd(), 'packages', 'bmsx-console', 'src'),
	];
	if (platform === 'browser') {
		roots.push(join(process.cwd(), 'packages', 'bmsx-browser-host', 'src'));
	}
	if (platform === 'headless' || platform === 'cli') {
		roots.push(join(process.cwd(), 'packages', 'bmsx-node-host', 'src'));
	}
	return roots;
}

async function shouldForceRebuildForPlatformSources(options: ParsedPlatformOptions): Promise<boolean> {
	if (options.force) {
		return false;
	}
	const artifactPath = resolvePlatformArtifactPath(options.platform, options.debug);
	if (!artifactPath) {
		return false;
	}
	if (!existsSync(artifactPath)) {
		return true;
	}
	const artifactMtime = await getMtimeMs(artifactPath);
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
		process.exit(0);
	}

	const debug = seenFlags.has('--debug');
	const force = seenFlags.has('--force');
	const platformRaw = getParamOrEnv(args, '--platform', 'ROM_PLATFORM', 'browser', KNOWN_FLAGS);
	const platform = platformRaw.toLowerCase() as RomPackerTarget;

	return {
		platform,
		debug,
		force,
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
	const logger: BuilderLogger = {
		divider: ui.divider,
		bullet: ui.bullet,
		info: ui.info,
		ok: ui.ok,
		progress: undefined,
	};
	let progress: TaskProgressReporter | undefined;
	if (options.platform === 'browser' || options.platform === 'headless' || options.platform === 'cli') {
		progress = ui.createProgress(getPlatformTaskList(options.platform));
		logger.progress = progress;
	}
	try {
		await runPlatformBuild(options, logger);
	} finally {
		if (progress) {
			progress.stop();
		}
	}
	ui.writeOut('\n');
}

main().catch(err => {
	const message = err instanceof Error ? err.message : String(err);
	ui.writeOut(`${pc.red(message)}\n`);
	process.exit(1);
});
