import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { NODE_TEST_BUNDLE_OPTIONS } from '../../../scripts/lib/node_test_bundle.mjs';

const sources = import.meta.dirname;
const root = resolve(import.meta.dirname, '../../..');
const { values } = parseArgs({ options: { 'native-build-dir': { type: 'string' }, 'system-rom': { type: 'string' } } });
const prebuilt = values['native-build-dir'];
const nativeBuild = resolve(root, prebuilt ?? 'build-cpp-tests');
const replayTarget = 'bmsx_runtime_replay_conformance_runner';
const rewindTargets = ['bmsx_host_rewind_conformance_runner', 'bmsx_libretro_rewind_conformance_runner'];
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

if (values['system-rom'] === undefined) {
	await run(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts', '--mode', 'bios', '--debug']);
}
if (prebuilt === undefined) {
	await run('cmake', ['-S', 'machine/cpp', '-B', nativeBuild, '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON',
		'-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON']);
	await run('cmake', ['--build', nativeBuild, '--target', replayTarget, ...rewindTargets, '--parallel', '4']);
}
const bios = resolve(root, values['system-rom'] ?? 'dist/system/bmsx-bios.debug.rom');
// Keep executables in Node's package scope and test evidence off the system
// temp directory (which may be tmpfs and share the test memory budget).
const workspaceArtifacts = join(root, '.bmsx');
mkdirSync(workspaceArtifacts, { recursive: true });
// The source cart must remain outside the worktree: the packer's workspace
// scan doesn't include git-ignored sources.
const cartridges = mkdtempSync(join(tmpdir(), 'bmsx-runtime-replay-'));
let artifacts;
try {
	artifacts = mkdtempSync(join(workspaceArtifacts, 'runtime-replay-'));
	// Like the shipped Node emulator, resolve core imports at build time;
	// per-module CommonJS export getters are costly in interpreter and GX loops.
	await build({
		...NODE_TEST_BUNDLE_OPTIONS,
		entryPoints: ['build_cartridges', 'host_ts_runner', 'ts_runner'].map(name => join(sources, `${name}.ts`)),
		outdir: artifacts,
		outExtension: { '.js': '.cjs' },
		format: 'cjs',
	});
	await run(process.execPath, ['--enable-source-maps', join(artifacts, 'build_cartridges.cjs'),
		cartridges, bios, join(sources, 'host_rewind.lua')]);
	const rewindCart = join(cartridges, 'cart.rom');
	copyFileSync(bios, join(artifacts, 'bmsx-bios.rom'));
	// These hosts consume the same installed bytes but do not write each other's evidence.
	const jobs = [
		run(process.execPath, ['--enable-source-maps', join(artifacts, 'host_ts_runner.cjs'), bios, rewindCart]),
		...rewindTargets.map(target => run(join(nativeBuild, target), [artifacts, rewindCart])),
	];
	const cppLog = join(artifacts, 'cpp.json');
	const cpp = run(join(nativeBuild, replayTarget), [bios, rewindCart, cppLog]);
	jobs.push(cpp);
	for (const engine of ['default', 'javascript']) {
		const tsLog = join(artifacts, `ts-${engine}.json`);
		const ts = run(process.execPath, ['--enable-source-maps', join(artifacts, 'ts_runner.cjs'), bios, rewindCart, tsLog, engine]);
		jobs.push(ts);
		jobs.push(Promise.all([cpp, ts]).then(() => {
			assert.deepEqual(JSON.parse(readFileSync(tsLog, 'utf8')), JSON.parse(readFileSync(cppLog, 'utf8')),
				`TS (${engine}) and C++ replay observations`);
			console.log(`RUNTIME-REPLAY-CROSS-CORE:${engine}:PASS`);
		}));
	}
	// Join the producers as well as the comparisons. A failed input must not let
	// cleanup remove the evidence directory while another process still uses it.
	const failures = new Set();
	for (const result of await Promise.allSettled(jobs)) if (result.status === 'rejected') failures.add(result.reason);
	if (failures.size !== 0) throw new AggregateError(failures, 'Runtime replay conformance failed');
	rmSync(artifacts, { recursive: true, force: true });
} catch (error) {
	if (artifacts !== undefined) console.error(`Replay evidence retained at ${artifacts}`);
	throw error;
} finally {
	rmSync(cartridges, { recursive: true, force: true });
}
