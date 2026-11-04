import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../../scripts/test.sh', import.meta.url));
const membership = readFileSync('/proc/self/cgroup', 'utf8');
const group = membership.split('\n').find(line => line.startsWith('0::')).slice(3);

test('the test worker and its subprocess share the installed kernel memory budget', () => {
	const directory = `/sys/fs/cgroup${group}`;
	assert.equal(readFileSync(`${directory}/memory.max`, 'utf8').trim(), '1073741824');
	assert.equal(readFileSync(`${directory}/memory.swap.max`, 'utf8').trim(), '0');
	assert.equal(readFileSync(`${directory}/memory.oom.group`, 'utf8').trim(), '1');
	const child = spawnSync('cat', ['/proc/self/cgroup'], { encoding: 'utf8', timeout: 5000 });
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, membership);
});

test('nested runners retain the same budget without contacting the user manager again', () => {
	const child = spawnSync('bash', [runner, 'bash', runner, 'cat', '/proc/self/cgroup'], {
		encoding: 'utf8', timeout: 5000,
		env: { ...process.env,
			XDG_RUNTIME_DIR: '/nonexistent/bmsx-test-runtime',
			DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/bmsx-test-bus',
		},
	});
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, membership, 'a nested runner must not create a sibling allowance');
});

test('the bounded command retains literal argv, environment, cwd and all standard streams', t => {
	const cwd = mkdtempSync(join(tmpdir(), 'bmsx-test-runner-'));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const args = ['', 'with spaces', '$BMSX_RUNNER_LITERAL', '${BMSX_RUNNER_LITERAL}', '"; echo not-a-shell-command', 'é'];
	const child = spawnSync('bash', [runner, process.execPath, '-e', `
		const { readFileSync } = require('node:fs');
		console.log(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(),
			env: process.env.BMSX_RUNNER_LITERAL, input: readFileSync(0, 'utf8') }));
		process.stderr.write('stderr stays stderr');
	`, ...args], {
		cwd, encoding: 'utf8', input: 'stdin stays stdin', timeout: 5000,
		env: { ...process.env, BMSX_RUNNER_LITERAL: 'literal $value with spaces' },
	});
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout), {
		args, cwd, env: 'literal $value with spaces', input: 'stdin stays stdin',
	});
	assert.equal(child.stderr, 'stderr stays stderr');
});

test('command exit status and termination signals are not translated into success', () => {
	const failure = spawnSync('bash', [runner, process.execPath, '-e', 'process.exit(37)'], { timeout: 5000 });
	assert.equal(failure.status, 37);
	assert.equal(failure.signal, null);
	const terminated = spawnSync('bash', [runner, process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'], { timeout: 5000 });
	assert.equal(terminated.status, null);
	assert.equal(terminated.signal, 'SIGTERM');
});

test('an empty invocation or missing executable fails instead of starting another command', () => {
	const empty = spawnSync('bash', [runner], { encoding: 'utf8', timeout: 5000 });
	assert.equal(empty.status, 2);
	const missing = spawnSync('bash', [runner, '/nonexistent/bmsx-test-executable'], { encoding: 'utf8', timeout: 5000 });
	assert.equal(missing.status, 127);
	assert.equal(missing.stdout, '');
});
