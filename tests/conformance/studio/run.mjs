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
	await rm(workRoot, { recursive: true, force: true });
	console.log('Studio conformance: GAME0-BOARD1|GAME1-BOARD0');
} catch (error) {
	console.error(`${error}\nConformance artifacts retained at ${workRoot}`);
	process.exitCode = 1;
}
