import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PROCESS_SCOPE_PRODUCT_DIRECTORY, PROCESS_SCOPE_PRODUCT_FILE } from '../../hosts/node/process_scope/product.ts';
import { ProcessScope } from '../../hosts/node/process_scope/scope.ts';
import { encodeLaunch } from '../../hosts/node/process_scope/protocol.ts';

test('host departure during launch decoding releases an empty scope, not an interrupted workload', { timeout: 10000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-scope-launch-'));
	const lock = join(root, 'owner.lock');
	const product = JSON.parse(await readFile(PROCESS_SCOPE_PRODUCT_FILE, 'utf8'));
	const launch = encodeLaunch(process.execPath, ['-e', 'process.exit(99)'], root, { SystemRoot: process.env.SystemRoot });
	try {
		for (const length of [0, 1, 3, 8, launch.length - 1]) {
			const child = spawn(join(PROCESS_SCOPE_PRODUCT_DIRECTORY, product.executable), [lock], {
				stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true, windowsHide: true,
			});
			const exited = once(child, 'close');
			const status = createInterface({ input: child.stdio[4] });
			const [first] = await once(status, 'line');
			assert.equal(first, 'locked');
			child.stdio[3].end(launch.subarray(0, length));
			assert.deepEqual(await exited, [0, null]);
			const scope = await ProcessScope.acquire(lock);
			await scope.release();
		}
	} finally { await rm(root, { recursive: true }); }
});

test('termination before startup cannot launch work after the scope has drained', { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-scope-retire-'));
	const lock = join(root, 'owner.lock'), marker = join(root, 'launched');
	const product = JSON.parse(await readFile(PROCESS_SCOPE_PRODUCT_FILE, 'utf8'));
	const child = spawn(join(PROCESS_SCOPE_PRODUCT_DIRECTORY, product.executable), [lock], {
		stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true,
	});
	const exited = once(child, 'close');
	const status = createInterface({ input: child.stdio[4] });
	const drained = Promise.withResolvers();
	const records = [];
	status.on('line', line => { records.push(line); if (line === 'drained') drained.resolve(); });
	try {
		await once(status, 'line');
		child.kill('SIGTERM');
		await drained.promise;
		assert.ok(records.includes(`exit\t-1\t${constants.signals.SIGTERM}`));
		await assert.rejects(ProcessScope.acquire(lock), /already owned/);
		child.stdio[3].end(encodeLaunch(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`], root, {}));
		assert.deepEqual(await exited, [0, null]);
		await assert.rejects(readFile(marker), { code: 'ENOENT' });
		const next = await ProcessScope.acquire(lock);
		await next.release();
	} finally {
		child.stdio[3].end(); await exited;
		await rm(root, { recursive: true });
	}
});
