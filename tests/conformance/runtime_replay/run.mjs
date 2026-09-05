import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
// Fixed real-cart regression; the underlying runners also accept explicit ROM paths.
const cart = 'nemesis_s';

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

run('npm', ['run', 'build:toolchain:bios', '--', '--debug', '--force']);
run('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug', '--force']);
run('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON', '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_runtime_replay_conformance_runner', 'bmsx_host_rewind_conformance_runner', '--parallel', '4']);
const media = ['dist/bmsx-bios.debug.rom', `dist/${cart}.debug.rom`];
const directory = mkdtempSync(join(tmpdir(), 'bmsx-runtime-replay-'));
const tsPrefix = join(directory, 'ts');
const cppPrefix = join(directory, 'cpp');
try {
	run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/ts_runner.ts', ...media, tsPrefix]);
	run('build-cpp-tests/bmsx_runtime_replay_conformance_runner', [...media, cppPrefix]);
	run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/compare.ts', tsPrefix, cppPrefix]);
	run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/host_ts_runner.ts', ...media]);
	copyFileSync(media[0], join(directory, 'bmsx-bios.rom'));
	run('build-cpp-tests/bmsx_host_rewind_conformance_runner', [directory, media[1]]);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
