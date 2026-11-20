import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '../../..');
const { values } = parseArgs({ options: { 'native-build-dir': { type: 'string' } } });
const prebuilt = values['native-build-dir'];
const nativeBuild = resolve(root, prebuilt ?? 'build-cpp-tests');
const replayTarget = 'bmsx_runtime_replay_conformance_runner';
const rewindTargets = [
	'bmsx_host_rewind_conformance_runner',
	'bmsx_snesmini_host_rewind_conformance_runner', 'bmsx_libretro_rewind_conformance_runner',
];
// Real-cart regression plus an independent source fixture, using the same runners.
const cart = 'nemesis_s';

function run(command, args) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
		child.once('error', reject);
		child.once('close', (status, signal) => {
			if (status === 0) resolveRun();
			else reject(new Error(`${command} ${args.join(' ')} exited with ${status ?? signal}`));
		});
	});
}

await run('npm', ['run', 'build:toolchain:bios', '--', '--debug']);
await run('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug']);
if (prebuilt === undefined) {
	await run('cmake', ['-S', 'machine/cpp', '-B', nativeBuild, '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON',
		'-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON']);
	await run('cmake', ['--build', nativeBuild, '--target', replayTarget, ...rewindTargets, '--parallel', '4']);
}
const media = ['dist/system/bmsx-bios.debug.rom', `dist/${cart}.debug.rom`];
const directory = mkdtempSync(join(tmpdir(), 'bmsx-runtime-replay-'));
try {
	await run('npx', ['tsx', 'tests/conformance/runtime_replay/preload_cartridge.ts', directory, media[0]]);
	copyFileSync(media[0], join(directory, 'bmsx-bios.rom'));
	// These hosts consume the same installed bytes but do not write each other's evidence.
	const jobs = [
		run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/host_ts_runner.ts', ...media]),
		...rewindTargets.map(target => run(join(nativeBuild, target), [directory, media[1]])),
	];
	// The real cart also replays through the selectable JavaScript backend.
	for (const [name, cartridge, assertions, backends] of [
		[cart, media[1], ['--require-badp-playback'], ['default', 'javascript']],
		['preload', join(directory, 'cart.rom'), ['--require-raw-byte-string'], ['default']],
	]) {
		const cppPrefix = join(directory, `${name}-cpp`);
		const cpp = run(join(nativeBuild, replayTarget), [media[0], cartridge, cppPrefix]);
		jobs.push(cpp);
		for (const backend of backends) {
			const tsPrefix = join(directory, `${name}-ts-${backend}`);
			const ts = run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/runtime_replay/ts_runner.ts', media[0], cartridge, tsPrefix, backend]);
			jobs.push(ts);
			jobs.push(Promise.all([cpp, ts]).then(() => run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json',
				'tests/conformance/runtime_replay/compare.ts', tsPrefix, cppPrefix, ...assertions])));
		}
	}
	// Join the producers as well as the comparisons. A failed input must not let
	// cleanup remove the evidence directory while another process still uses it.
	const failures = new Set();
	for (const result of await Promise.allSettled(jobs)) if (result.status === 'rejected') failures.add(result.reason);
	if (failures.size !== 0) throw new AggregateError(failures, 'Runtime replay conformance failed');
} finally {
	rmSync(directory, { recursive: true, force: true });
}
