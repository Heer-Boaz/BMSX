import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const workRoot = await mkdtemp(join(tmpdir(), 'bmsx-studio-conformance-'));
const boardRom = join(workRoot, 'studio-board.rom');

function run(label, command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) {
		throw new Error(`${label} failed to start: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`${label} exited with ${result.status}.\n${result.stdout}\n${result.stderr}`);
	}
	return `${result.stdout}\n${result.stderr}`;
}

try {
	run('BIOS build', 'npm', ['run', 'build:toolchain:bios', '--', '--debug', '--force']);
	run('Studio conformance cartridge build', 'npm', [
		'run', 'build:toolchain:cart', '--', 'studio_conformance', '--debug', '--force',
	]);
	run('Node Studio tooling build', 'npm', [
		'run', 'build:product:node-headless-tooling', '--', '--debug', '--force',
	]);
	run('Studio board media build', 'npx', [
		'tsx', '--tsconfig', 'tsconfig.base.json',
		'tests/conformance/studio/create_board_rom.ts', boardRom,
	]);
	const output = run('TypeScript Studio conformance', 'npx', [
		'tsx', '--tsconfig', 'tsconfig.base.json',
		'tests/conformance/studio/ts_runner.ts',
		'dist/bmsx-bios.debug.rom',
		'dist/studio_conformance.debug.rom',
		boardRom,
	]);
	if (!output.includes('BMSX-STUDIO-CONFORMANCE=GAME0-BOARD1|GAME1-BOARD0')) {
		throw new Error(`Studio conformance signature missing.\n${output}`);
	}
	const hostScenario = 'tests/ide/studio_host_chrome.idetest.js';
	const game0Output = run('Studio host chrome game0/board1', 'node', [
		'dist/host_headless_tooling.debug.js',
		'--system-rom', 'dist/bmsx-bios.debug.rom',
		'--rom', 'dist/studio_conformance.debug.rom',
		'--slot1', boardRom,
		'--ttl', '30',
		'--ide-test', hostScenario,
	]);
	if (!game0Output.includes('studio_host_chrome.idetest.js passed (19 assertions)')) {
		throw new Error(`Studio game0/board1 host signature missing.\n${game0Output}`);
	}
	const game1Output = run('Studio host chrome board0/game1', 'node', [
		'dist/host_headless_tooling.debug.js',
		'--system-rom', 'dist/bmsx-bios.debug.rom',
		'--rom', boardRom,
		'--slot1', 'dist/studio_conformance.debug.rom',
		'--ttl', '30',
		'--ide-test', hostScenario,
	]);
	if (!game1Output.includes('studio_host_chrome.idetest.js passed (19 assertions)')) {
		throw new Error(`Studio board0/game1 host signature missing.\n${game1Output}`);
	}
	await rm(workRoot, { recursive: true, force: true });
	console.log('Studio conformance: GUEST+HOST GAME0-BOARD1|GAME1-BOARD0');
} catch (error) {
	console.error(`${error}\nConformance artifacts retained at ${workRoot}`);
	process.exitCode = 1;
}
