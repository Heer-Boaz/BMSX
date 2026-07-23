import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../../..');
const workRoot = await mkdtemp(join(tmpdir(), 'bmsx-cartridge-conformance-'));
const systemRom = join(workRoot, 'bmsx-bios.rom');
const dataRom = join(workRoot, 'data.rom');
const bootableCartRom = join(workRoot, 'bootable-cart.rom');
const expected = 'READY|STEP1|STEP1';

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

function signature(output, label) {
	const match = output.match(/^BMSX-CARTRIDGE-CONFORMANCE=(.+)$/m);
	if (!match) {
		throw new Error(`${label} did not publish a conformance signature.\n${output}`);
	}
	return match[1];
}

async function hash(path) {
	return createHash('sha256').update(await readFile(path)).digest('hex');
}

try {
	run('headless platform build', 'npm', ['run', 'build:platform:headless', '--', '--force']);
	run('BIOS build', 'npm', ['run', 'build:bios', '--', '--force']);
	run('conformance cartridge build', 'npm', ['run', 'build:game', '--', 'cartridge_conformance', '--force']);
	run('native test configure', 'cmake', [
		'-S', 'machine/cpp',
		'-B', 'build-cpp-tests',
		'-G', 'Ninja',
		'-DBMSX_BUILD_TESTS=ON',
	]);
	run('native conformance runner build', 'cmake', [
		'--build', 'build-cpp-tests',
		'--target', 'bmsx_cartridge_conformance_runner',
		'--parallel', '2',
	]);

	await Promise.all([
		copyFile(join(root, 'dist', 'bmsx-bios.rom'), systemRom),
		copyFile(join(root, 'dist', 'cartridge_conformance.rom'), bootableCartRom),
	]);
	run('data-cartridge fixture build', 'npx', [
		'tsx',
		'--tsconfig', 'tsconfig.base.json',
		'tests/conformance/cartridge/create_data_rom.ts',
		bootableCartRom,
		dataRom,
	]);
	await Promise.all([
		chmod(systemRom, 0o444),
		chmod(dataRom, 0o444),
		chmod(bootableCartRom, 0o444),
	]);
	const before = await Promise.all([hash(systemRom), hash(dataRom), hash(bootableCartRom)]);

	const tsOutput = run('TypeScript headless conformance', 'npx', [
		'tsx',
		'--tsconfig', 'tsconfig.base.json',
		'tests/conformance/cartridge/ts_runner.ts',
		systemRom,
		dataRom,
		bootableCartRom,
	]);
	const cppOutput = run('native libretro conformance', 'build-cpp-tests/bmsx_cartridge_conformance_runner', [
		systemRom,
		dataRom,
		bootableCartRom,
	]);
	const tsSignature = signature(tsOutput, 'TypeScript headless');
	const cppSignature = signature(cppOutput, 'native libretro');
	if (tsSignature !== expected || cppSignature !== expected || tsSignature !== cppSignature) {
		throw new Error(
			`Conformance mismatch: expected=${expected}, TypeScript=${tsSignature}, native=${cppSignature}.`,
		);
	}
	const after = await Promise.all([hash(systemRom), hash(dataRom), hash(bootableCartRom)]);
	if (before.some((value, index) => value !== after[index])) {
		throw new Error('A runtime modified the immutable conformance media.');
	}

	await chmod(systemRom, 0o644);
	await chmod(dataRom, 0o644);
	await chmod(bootableCartRom, 0o644);
	await rm(workRoot, { recursive: true, force: true });
	console.log(`Cartridge conformance parity: ${expected}`);
} catch (error) {
	console.error(`${error}\nConformance artifacts retained at ${workRoot}`);
	process.exitCode = 1;
}
