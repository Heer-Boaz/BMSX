import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
// Real-cart regression plus an independent source fixture, using the same runners.
const cart = 'nemesis_s';

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

run('npm', ['run', 'build:toolchain:bios', '--', '--debug', '--force']);
run('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug', '--force']);
run('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON', '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_runtime_replay_conformance_runner', 'bmsx_host_rewind_conformance_runner', 'bmsx_libretro_rewind_conformance_runner', '--parallel', '4']);
const media = ['dist/bmsx-bios.debug.rom', `dist/${cart}.debug.rom`];
const directory = mkdtempSync(join(tmpdir(), 'bmsx-runtime-replay-'));
try {
	run('npx', ['tsx', 'tests/conformance/runtime_replay/preload_cartridge.ts', directory, media[0]]);
	for (const [name, cartridge, assertions] of [
		[cart, media[1], ['--require-badp-playback']],
		['preload', join(directory, 'cart.rom'), []],
	]) {
		const tsPrefix = join(directory, `${name}-ts`);
		const cppPrefix = join(directory, `${name}-cpp`);
		run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/ts_runner.ts', media[0], cartridge, tsPrefix]);
		run('build-cpp-tests/bmsx_runtime_replay_conformance_runner', [media[0], cartridge, cppPrefix]);
		run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/compare.ts', tsPrefix, cppPrefix, ...assertions]);
	}
	run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/host_ts_runner.ts', ...media]);
	copyFileSync(media[0], join(directory, 'bmsx-bios.rom'));
	run('build-cpp-tests/bmsx_host_rewind_conformance_runner', [directory, media[1]]);
	run('build-cpp-tests/bmsx_libretro_rewind_conformance_runner', [directory, media[1]]);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
