import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { NODE_TEST_BUNDLE_OPTIONS } from '../../../scripts/lib/node_test_bundle.mjs';

const sources = import.meta.dirname;
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

await run('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug']);
if (prebuilt === undefined) {
	await run('cmake', ['-S', 'machine/cpp', '-B', nativeBuild, '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON',
		'-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON']);
	await run('cmake', ['--build', nativeBuild, '--target', replayTarget, ...rewindTargets, '--parallel', '4']);
}
const media = ['dist/system/bmsx-bios.debug.rom', `dist/${cart}.debug.rom`];
// Keep executables in Node's package scope and state dumps off the system
// temp directory (which may be tmpfs and share the test memory budget).
const workspaceArtifacts = join(root, '.bmsx');
mkdirSync(workspaceArtifacts, { recursive: true });
// The source cart must remain outside the worktree: the packer's workspace
// scan doesn't include git-ignored sources.
const preloadDirectory = mkdtempSync(join(tmpdir(), 'bmsx-runtime-replay-'));
let artifacts;
try {
	artifacts = mkdtempSync(join(workspaceArtifacts, 'runtime-replay-'));
	// Like the shipped Node emulator, resolve core imports at build time;
	// per-module CommonJS export getters are costly in interpreter and GX loops.
	await build({
		...NODE_TEST_BUNDLE_OPTIONS,
		entryPoints: ['preload_cartridge', 'host_ts_runner', 'ts_runner', 'compare'].map(name => join(sources, `${name}.ts`)),
		outdir: artifacts,
		outExtension: { '.js': '.cjs' },
		format: 'cjs',
	});
	await run(process.execPath, ['--enable-source-maps', join(artifacts, 'preload_cartridge.cjs'), preloadDirectory, media[0]]);
	copyFileSync(media[0], join(artifacts, 'bmsx-bios.rom'));
	// These hosts consume the same installed bytes but do not write each other's evidence.
	const jobs = [
		run(process.execPath, ['--enable-source-maps', join(artifacts, 'host_ts_runner.cjs'), ...media]),
		...rewindTargets.map(target => run(join(nativeBuild, target), [artifacts, media[1]])),
	];
	// The real cart also replays through the selectable JavaScript backend.
	for (const [name, cartridge, assertions, backends] of [
		[cart, media[1], ['--require-badp-playback'], ['default', 'javascript']],
		['preload', join(preloadDirectory, 'cart.rom'), ['--require-raw-byte-string'], ['default']],
	]) {
		const cppPrefix = join(artifacts, `${name}-cpp`);
		const cpp = run(join(nativeBuild, replayTarget), [media[0], cartridge, cppPrefix]);
		jobs.push(cpp);
		for (const backend of backends) {
			const tsPrefix = join(artifacts, `${name}-ts-${backend}`);
			const ts = run(process.execPath, ['--enable-source-maps', join(artifacts, 'ts_runner.cjs'), media[0], cartridge, tsPrefix, backend]);
			jobs.push(ts);
			jobs.push(Promise.all([cpp, ts]).then(() => run(process.execPath, ['--enable-source-maps',
				join(artifacts, 'compare.cjs'), tsPrefix, cppPrefix, ...assertions])));
		}
	}
	// Join the producers as well as the comparisons. A failed input must not let
	// cleanup remove the evidence directory while another process still uses it.
	const failures = new Set();
	for (const result of await Promise.allSettled(jobs)) if (result.status === 'rejected') failures.add(result.reason);
	if (failures.size !== 0) throw new AggregateError(failures, 'Runtime replay conformance failed');
} finally {
	if (artifacts !== undefined) rmSync(artifacts, { recursive: true, force: true });
	rmSync(preloadDirectory, { recursive: true, force: true });
}
