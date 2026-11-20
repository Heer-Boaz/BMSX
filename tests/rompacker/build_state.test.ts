import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterTest } from '../helpers/test_cleanup';

test('ROM recipe ignores npm commands, not module resolution or locked dependencies', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-toolchain-identity-'));
	afterTest(t, () => rm(root, { recursive: true, force: true }));
	const run = promisify(execFile);
	await run('git', ['init', '-q'], { cwd: root });
	const manifest = {
		name: 'build-state-probe', type: 'commonjs',
		scripts: { test: 'node --test before.mjs' },
		imports: { '#source': { node: './node.js', default: './generic.js' } },
	};
	const lock = { lockfileVersion: 3, packages: { 'node_modules/probe': { version: '1.0.0' } } };
	const variants = [
		[manifest, lock],
		[{ ...manifest, scripts: { test: 'node --test after.mjs' } }, lock],
		[{ ...manifest, type: 'module' }, lock],
		[{ ...manifest, imports: { '#source': { default: './generic.js', node: './node.js' } } }, lock],
		[manifest, { ...lock, packages: { 'node_modules/probe': { version: '1.1.0' } } }],
	];
	// Source discovery belongs to the process's Git workspace. Probe the actual
	// recipe in a private workspace rather than changing this runner's cwd.
	const builder = pathToFileURL(resolve('scripts/rompacker/build_state.ts')).href;
	const { stdout } = await run(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), '--input-type=module', '-e', `
		import { writeFileSync } from 'node:fs';
		import { romToolchainIdentity } from ${JSON.stringify(builder)};
		for (const [manifest, lock] of JSON.parse(process.argv[1])) {
			writeFileSync('package.json', JSON.stringify(manifest));
			writeFileSync('package-lock.json', JSON.stringify(lock));
			console.log(romToolchainIdentity({ kind: 'filesystem' }));
		}
	`, JSON.stringify(variants)], { cwd: root });
	const [initial, commandEdit, moduleType, importOrder, lockEdit] = stdout.trim().split('\n');
	assert.equal(commandEdit, initial, 'a test command does not change the ROM recipe');
	assert.notEqual(moduleType, initial, 'Node module format remains an input');
	assert.notEqual(importOrder, initial, 'the first matching import condition owns resolution');
	assert.notEqual(lockEdit, initial, 'the dependency lock remains an input');
});
