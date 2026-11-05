import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const runner = fileURLToPath(new URL('../../scripts/test.sh', import.meta.url));
const membership = readFileSync('/proc/self/cgroup', 'utf8');
const group = membership.split('\n').find(line => line.startsWith('0::')).slice(3);
const mountRoot = '/sys/fs/cgroup';
const ancestors = [];
for (let directory = `${mountRoot}${group === '/' ? '' : group}`;; directory = dirname(directory)) {
	ancestors.push(directory);
	if (directory === mountRoot) break;
}

function hasBudget(directory) {
	if (!existsSync(join(directory, 'memory.max'))) return false;
	const maximum = readFileSync(join(directory, 'memory.max'), 'utf8').trim();
	return maximum !== 'max' && BigInt(maximum) <= 8589934592n;
}

test('the test worker and its subprocess share the installed kernel memory budget', () => {
	assert.ok(ancestors.some(hasBudget), 'the kernel must bound the worker, not just advertise a requested limit');
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

let namespaceCapability;
/** Bind real cgroupfs, not fabricated /proc or control files; the outer test budget never changes. */
function inCgroupNamespace(t, directory, joinGroup, body, args = [], options = {}) {
	namespaceCapability ??= spawnSync('unshare', ['--user', '--map-root-user', '--mount', '--cgroup', 'true'], { encoding: 'utf8' });
	if (namespaceCapability.status !== 0) {
		t.skip(`Kernel user/mount/cgroup namespaces unavailable: ${namespaceCapability.stderr || namespaceCapability.error?.message}`);
		return;
	}
	const child = spawnSync('unshare', ['--user', '--map-root-user', '--mount', 'bash', '-ec', `
		mount --make-rprivate / || exit 77
		mount --bind "$1" /sys/fs/cgroup || exit 77
		if [[ $2 == join ]]; then printf '%s\\n' "$BASHPID" > /sys/fs/cgroup/cgroup.procs; fi
		shift 2
		exec unshare --cgroup bash -ec "$@"
	`, 'namespace-fixture', directory, joinGroup ? 'join' : 'current', body, 'namespace-body', ...args], {
		encoding: 'utf8', timeout: 10000, ...options,
		env: { ...process.env, XDG_RUNTIME_DIR: '', DBUS_SESSION_BUS_ADDRESS: '', BMSX_TEST_CGROUP_PARENT: '', ...options.env },
	});
	if (child.status === 77) {
		t.skip(`Kernel cgroup bind/remount unavailable: ${child.stderr}`);
		return;
	}
	return child;
}

async function retireFixture(directory) {
	writeFileSync(join(directory, 'cgroup.kill'), '1');
	while (!readFileSync(join(directory, 'cgroup.events'), 'utf8').split('\n').includes('populated 0')) await setTimeout(5);
	function removeEmpty(path) {
		for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) removeEmpty(join(path, entry.name));
		rmdirSync(path);
	}
	removeEmpty(directory);
}

/** A weaker visible view remains constrained by the unchanged hidden outer test budget. */
function cgroupFixture(t, maximum = '17179869184') {
	const parent = ancestors.find(directory => {
		if (!hasBudget(directory) || readFileSync(join(directory, 'cgroup.procs'), 'utf8').trim() !== '') return false;
		if (!readFileSync(join(directory, 'cgroup.subtree_control'), 'utf8').trim().split(' ').includes('memory')) return false;
		try {
			accessSync(directory, constants.W_OK | constants.X_OK);
			accessSync(join(directory, 'cgroup.procs'), constants.W_OK);
			return true;
		} catch (error) {
			if (error.code !== 'EACCES' && error.code !== 'EROFS') throw error;
			return false;
		}
	});
	if (parent === undefined) {
		t.skip('Host has not delegated an empty memory-enabled parent beneath this shared test budget.');
		return;
	}
	const directory = mkdtempSync(join(parent, 'bmsx-runner-fixture-'));
	t.after(() => retireFixture(directory));
	writeFileSync(join(directory, 'memory.max'), maximum);
	writeFileSync(join(directory, 'memory.swap.max'), 'max');
	writeFileSync(join(directory, 'memory.oom.group'), '0');
	mkdirSync(join(directory, 'supervisor'));
	return directory;
}

const readOnlyRoot = 'mount -o remount,bind,ro,nosuid,nodev,noexec /sys/fs/cgroup || exit 77';

test('a read-only prebounded namespace root needs neither systemd nor delegation', t => {
	const currentIsBounded = hasBudget(ancestors[0]);
	const directory = currentIsBounded ? ancestors[0] : cgroupFixture(t, '8589934592');
	if (directory === undefined) return;
	const child = inCgroupNamespace(t, directory, !currentIsBounded, `${readOnlyRoot}; exec bash "$1" cat /proc/self/cgroup`, [runner]);
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, '0::/\n');
});

test('a descendant reuses its bounded namespace root instead of trying the user manager', t => {
	const fixture = cgroupFixture(t, '8589934592');
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, `
		printf '%s\\n' "$BASHPID" > /sys/fs/cgroup/supervisor/cgroup.procs
		exec bash "$1" cat /proc/self/cgroup
	`, [runner]);
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, '0::/supervisor\n');
});

test('the read-only 8 GiB ChatGPT container runs without swap, OOM, installer or mode prerequisites', t => {
	const fixture = cgroupFixture(t, '8589934592');
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, `
		${readOnlyRoot}
		unset XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS BMSX_TEST_CGROUP_PARENT
		export PATH=/nonexistent/installer-tools
		exec /bin/bash "$1" /bin/bash -ec '
			for field in memory.max memory.swap.max memory.oom.group; do
				IFS= read -r value < "/sys/fs/cgroup/$field"
				printf "%s\\n" "$value"
			done
			IFS= read -r membership < /proc/self/cgroup
			printf "%s\\n" "$membership"
		'
	`, [runner]);
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, '8589934592\nmax\n0\n0::/\n');
});

test('npm run test:exec -- true works in the read-only 8 GiB container without opt-in', t => {
	const fixture = cgroupFixture(t, '8589934592');
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, `
		${readOnlyRoot}
		unset XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS BMSX_TEST_CGROUP_PARENT
		exec "$@" run test:exec -- true
	`, [process.execPath, process.env.npm_execpath]);
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
});

test('a stricter inherited cap is not raised or reconfigured', t => {
	const fixture = cgroupFixture(t, '536870912');
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, `
		${readOnlyRoot}
		export BMSX_TEST_CGROUP_PARENT=/nonexistent/delegation
		exec /bin/bash "$1" /bin/bash -ec '
			IFS= read -r maximum < /sys/fs/cgroup/memory.max
			printf "%s\\n" "$maximum"
		'
	`, [runner]);
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, '536870912\n');
});

for (const maximum of ['17179869184', 'max']) test(`a read-only namespace with memory.max=${maximum} cannot admit a test without an accepted cap`, t => {
	const fixture = cgroupFixture(t, maximum);
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, `${readOnlyRoot}; exec bash "$1" printf PAYLOAD_STARTED`, [runner]);
	if (child === undefined) return;
	assert.equal(child.status, 1);
	assert.equal(child.stdout, '', 'neither a missing user bus nor read-only cgroupfs admits test code');
});

const delegatedRoot = `
	printf '%s\\n' "$BASHPID" > /sys/fs/cgroup/supervisor/cgroup.procs
	printf '+memory' > /sys/fs/cgroup/cgroup.subtree_control
	mkdir /sys/fs/cgroup/delegated
	export BMSX_TEST_CGROUP_PARENT=/sys/fs/cgroup/delegated
	exec bash "$@"
`;

test('direct delegation installs actual kernel limits and nested runners retain that exact group', t => {
	const fixture = cgroupFixture(t);
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, delegatedRoot, [runner, 'bash', '-ec', `
		group=$(cut -d: -f3 /proc/self/cgroup)
		for setting in memory.max memory.swap.max memory.oom.group; do cat "/sys/fs/cgroup$group/$setting"; done
		cat /proc/self/cgroup
		bash "$1" cat /proc/self/cgroup
	`, 'payload', runner]);
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
	const [maximum, swap, oom, current, nested] = child.stdout.trim().split('\n');
	assert.deepEqual([maximum, swap, oom], ['8589934592', '0', '1']);
	assert.ok(current.startsWith('0::/delegated/'), 'the workload belongs to a private child of the selected parent');
	assert.equal(nested, current);
	assert.deepEqual(readdirSync(join(fixture, 'delegated'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name), []);
});

for (const [name, payload, expectedStatus, expectedSignal] of [
	['normal exit 143', 'exit 143', 143, null],
	['SIGTERM', 'kill -TERM $$', null, 'SIGTERM'],
	['SIGPIPE', 'kill -PIPE $$', null, 'SIGPIPE'],
]) test(`direct delegation preserves ${name} without confusing exit codes and signals`, t => {
	const fixture = cgroupFixture(t);
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, delegatedRoot, [runner, 'bash', '-ec', payload]);
	if (child === undefined) return;
	assert.equal(child.status, expectedStatus, child.stderr);
	assert.equal(child.signal, expectedSignal, child.stderr);
});

test('direct delegation preserves streams and retires a surviving detached descendant', t => {
	const fixture = cgroupFixture(t);
	if (fixture === undefined) return;
	const cwd = mkdtempSync(join(tmpdir(), 'bmsx-direct-transport-'));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const args = ['', 'with spaces', '$BMSX_RUNNER_LITERAL', '"; echo not-a-command', 'é'];
	const child = inCgroupNamespace(t, fixture, true, delegatedRoot, [runner, process.execPath, '-e', `
		const { readFileSync } = require('node:fs'), { spawn } = require('node:child_process');
		console.log(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(),
			env: process.env.BMSX_RUNNER_LITERAL, input: readFileSync(0, 'utf8') }));
		process.stderr.write('separate stderr');
		spawn('setsid', ['sleep', '600'], { stdio: 'ignore' }).unref();
	`, ...args], { cwd, input: 'literal stdin $value\n', env: { BMSX_RUNNER_LITERAL: 'literal $environment' } });
	if (child === undefined) return;
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout), { args, cwd, env: 'literal $environment', input: 'literal stdin $value\n' });
	assert.equal(child.stderr, 'separate stderr');
	assert.deepEqual(readdirSync(join(fixture, 'delegated'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name), []);
});

test('interrupting the direct resource owner forwards the signal and completes retirement', t => {
	const fixture = cgroupFixture(t);
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, delegatedRoot, [runner, 'python3', '-c', `
import os, signal, time
print('payload admitted', flush=True)
os.kill(os.getppid(), signal.SIGTERM)
time.sleep(600)
`]);
	if (child === undefined) return;
	assert.equal(child.stdout, 'payload admitted\n');
	assert.equal(child.status, null, child.stderr);
	assert.equal(child.signal, 'SIGTERM', child.stderr);
	assert.deepEqual(readdirSync(join(fixture, 'delegated'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name), []);
});

test('an explicitly selected read-only delegated parent fails before test admission', t => {
	const fixture = cgroupFixture(t);
	if (fixture === undefined) return;
	const child = inCgroupNamespace(t, fixture, true, `
		printf '%s\\n' "$BASHPID" > /sys/fs/cgroup/supervisor/cgroup.procs
		printf '+memory' > /sys/fs/cgroup/cgroup.subtree_control
		mkdir /sys/fs/cgroup/delegated
		export BMSX_TEST_CGROUP_PARENT=/sys/fs/cgroup/delegated
		${readOnlyRoot}
		exec bash "$1" printf PAYLOAD_STARTED
	`, [runner]);
	if (child === undefined) return;
	assert.equal(child.status, 1);
	assert.equal(child.stdout, '');
});

test('a direct parent must be real cgroupfs and cannot create pretend control files', t => {
	const fixture = cgroupFixture(t);
	if (fixture === undefined) return;
	const ordinaryDirectory = mkdtempSync(join(tmpdir(), 'bmsx-not-cgroupfs-'));
	t.after(() => rmSync(ordinaryDirectory, { recursive: true, force: true }));
	const child = inCgroupNamespace(t, fixture, true, `
		export BMSX_TEST_CGROUP_PARENT="$2"
		exec bash "$1" printf PAYLOAD_STARTED
	`, [runner, ordinaryDirectory]);
	if (child === undefined) return;
	assert.equal(child.status, 1);
	assert.equal(child.stdout, '');
	assert.deepEqual(readdirSync(ordinaryDirectory), []);
});
