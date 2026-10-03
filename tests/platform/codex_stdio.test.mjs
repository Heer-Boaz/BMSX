import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { CodexStdio } from '../../hosts/node/codex/stdio.ts';
import { parseRpcMessage } from '../../hosts/node/codex/protocol.ts';
import { CodexProfile } from '../../hosts/node/codex/profile.ts';
import { CodexPolicy } from '../../hosts/node/codex/policy.ts';

const peer = fileURLToPath(new URL('../helpers/codex_stdio_peer.mjs', import.meta.url));
const execute = promisify(execFile);
async function connect(t, mode, receive = () => {}, timeout = 1000, args = []) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-stdio-'));
	const profile = await CodexProfile.acquire(root);
	const rpc = new CodexStdio(profile.scope, process.execPath, [peer, mode, ...args], profile.cwd, profile.env, receive, timeout, 1000);
	t.after(async () => { await rpc.stop(); await profile.release(); await rm(root, { recursive: true }); });
	return rpc;
}

test('request multiplexing drains a notification burst and a nested server request without waiting on the first response', async t => {
	let tool, deltas = 0;
	const rpc = await connect(t, 'multiplex', message => {
		if (message.method === 'tool') tool = message;
		if (message.method === 'delta') ++deltas;
	});
	const first = rpc.request('first', {});
	assert.equal(await rpc.request('second', {}), 'second');
	assert.equal(deltas, 10000);
	assert.equal(tool.id, 9);
	rpc.send({ id: tool.id, result: 'owned tool result' });
	assert.equal(await first, 'owned tool result');
	const exit = await rpc.stop();
	assert.equal(exit.code, 0); assert.equal(exit.forced, false); assert.equal(exit.error, undefined);
});

test('owned launch preserves Unicode/quoted argv, cwd and explicit PATH; the lock outlives RPC closure', { timeout: 10000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx scope é '));
	const profile = await CodexProfile.acquire(root);
	const args = ['', 'a b', 'é 🐈', 'quote"value', 'trailing\\', 'back\\\\"slash', '$(not a shell) & %PATH%'];
	const rpc = new CodexStdio(profile.scope, basename(process.execPath), [peer, 'launch', ...args], profile.cwd,
		{ ...profile.env, PATH: dirname(process.execPath), BMSX_SCOPE_MARKER: 'explicit 🐈' }, () => {});
	t.after(async () => { await rpc.stop(); await profile.release(); await rm(root, { recursive: true }); });
	const result = await rpc.request('inspect', {});
	assert.deepEqual(result, { args, cwd: profile.cwd, marker: 'explicit 🐈' });
	await writeFile(join(profile.codexHome, 'fixture-account'), 'persistent account data');
	await rpc.stop();
	await assert.rejects(CodexProfile.acquire(root), /Another Studio owns/);
	await profile.release();
	const next = await CodexProfile.acquire(root);
	try {
		assert.deepEqual(await readdir(next.cwd), []);
		assert.equal(await readFile(join(next.codexHome, 'fixture-account'), 'utf8'), 'persistent account data');
	} finally { await next.release(); }
});

test('host SIGKILL before workload startup releases the kernel lock and recovers only scratch', { timeout: 10000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-lease-crash-'));
	const owner = spawn(process.execPath, [...process.execArgv, peer, 'owner-lease', root], { stdio: ['pipe', 'pipe', 'inherit'] });
	const exited = once(owner, 'close');
	t.after(async () => { owner.stdin.end(); await exited; await rm(root, { recursive: true }); });
	const ready = createInterface({ input: owner.stdout });
	await once(ready, 'line'); ready.close();
	await writeFile(join(root, 'account', 'fixture-account'), 'keep');
	await writeFile(join(root, 'lease', 'workspace', 'unfinished'), 'scratch');
	await assert.rejects(CodexProfile.acquire(root), /Another Studio owns/);
	owner.kill('SIGKILL'); await exited;
	let next;
	for (let attempt = 0; attempt !== 100; ++attempt) {
		try { next = await CodexProfile.acquire(root); break; }
		catch (error) { assert.match(error.message, /Another Studio owns/); await setTimeout(10); }
	}
	assert.ok(next);
	try {
		assert.deepEqual(await readdir(next.cwd), []);
		assert.equal(await readFile(join(next.codexHome, 'fixture-account'), 'utf8'), 'keep');
	} finally { await next.release(); }
});

async function backgroundObserver(t) {
	const connected = Promise.withResolvers();
	const sockets = new Set();
	const server = createServer(socket => {
		sockets.add(socket);
		const lines = createInterface({ input: socket });
		lines.once('line', data => { lines.close(); connected.resolve({ socket, ...JSON.parse(data) }); });
		// TerminateJobObject can reset an active TCP connection instead of FIN.
		socket.on('error', error => assert.equal(error.code, 'ECONNRESET'));
		socket.once('close', () => sockets.delete(socket));
	});
	t.after(async () => {
		// Release peers when an assertion fails too; a failing lifecycle test must not leak them.
		for (const socket of sockets) socket.end();
		await new Promise(resolve => server.close(resolve));
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	return { port: server.address().port, connected: connected.promise };
}

async function assertProcessExited(pid) {
	// OS exit is the contract. TCP's close callback can still be queued after it.
	if (process.platform === 'win32') {
		assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
		return;
	}
	const { stdout } = await execute('ps', ['-A', '-o', 'pid=,stat=']);
	const member = stdout.split('\n').map(line => line.trim().split(/\s+/)).find(fields => Number(fields[0]) === pid);
	assert.ok(member === undefined || member[1][0] === 'Z' || member[1][0] === 'X', `process ${pid} still executes after closed`);
}

for (const mode of ['scope-eof', 'scope-crash', 'scope-group', 'scope-hang', 'scope-detached', 'scope-orphan']) {
	test(`${mode}: shutdown joins background children, including children that inherit the RPC pipes`,
		{ timeout: 10000, skip: mode === 'scope-group' && process.platform === 'win32' }, async t => {
			const observer = await backgroundObserver(t);
			const rpc = await connect(t, mode, () => {}, 1000, [String(observer.port)]);
			const pid = await rpc.request('spawn', {});
			const background = await observer.connected;
			if (mode !== 'scope-orphan') assert.equal(background.pid, pid);
			if (mode === 'scope-crash' || mode === 'scope-group') {
				rpc.setOutputPaused(true);
				await assert.rejects(rpc.request('crash', {}), /exited/);
			}
			const exit = await rpc.stop();
			assert.equal(exit.forced, mode === 'scope-hang');
			await assertProcessExited(pid);
			await assertProcessExited(background.pid);
		});
}

test('native plugin checkout has exited before its profile is removed, even after graceful App Server EOF',
	{ skip: process.platform === 'win32', timeout: 15000 }, async t => {
		const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-plugin-'));
		const observer = await backgroundObserver(t);
		const repo = join(root, 'plugins');
		await mkdir(repo);
		const git = (...args) => execute('git', args, { cwd: repo,
			env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1' } });
		await git('init', '-q');
		await writeFile(join(repo, '.gitattributes'), 'payload filter=held-checkout\n');
		await writeFile(join(repo, 'payload'), 'Local plugin checkout fixture\n');
		await git('add', '.');
		await git('-c', 'user.name=BMSX fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture');
		const profile = await CodexProfile.acquire(join(root, 'profile'));
		// Real Git and real native plugin startup, with a local repository and a
		// controlled smudge process. No credentials or network clone are needed.
		const filter = `${JSON.stringify(process.execPath)} ${JSON.stringify(peer)} background ${observer.port}`;
		await writeFile(join(profile.env.HOME, '.gitconfig'), `[url "file://${repo}"]\n`
			+ '\tinsteadOf = https://github.com/openai/plugins.git\n'
			+ `[filter "held-checkout"]\n\tsmudge = ${JSON.stringify(filter)}\n\trequired = true\n`);
		const policy = new CodexPolicy({ name: 'No inference', model: 'mock-model', baseUrl: 'http://127.0.0.1:1/v1' });
		const rpc = new CodexStdio(profile.scope, 'codex', policy.args, profile.cwd, profile.env, () => {});
		t.after(async () => { await rpc.stop(); await profile.release(); await rm(root, { recursive: true }); });
		await rpc.request('initialize', { clientInfo: { name: 'bmsx_process_fixture', version: '1' },
			capabilities: { experimentalApi: true } });
		rpc.send({ method: 'initialized', params: {} });
		const background = await observer.connected;
		const exit = await rpc.stop();
		assert.equal(exit.code, 0); assert.equal(exit.forced, false);
		await assertProcessExited(background.pid);
	});

for (const killed of [false, true]) test(`${killed ? 'SIGKILL' : 'abrupt exit'} of Node joins detached orphans before profile reacquisition`,
	{ timeout: 10000 }, async t => {
		const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-owner-'));
		const observer = await backgroundObserver(t);
		const owner = spawn(process.execPath, [...process.execArgv, peer, 'owner-exit', root, String(observer.port)],
			{ stdio: ['pipe', 'ignore', 'pipe'] });
		const exited = once(owner, 'close');
		let stderr = ''; owner.stderr.on('data', data => { stderr += data; });
		t.after(async () => { owner.stdin.end(); await exited; await rm(root, { recursive: true }); });
		const background = await observer.connected;
		const backgroundClosed = new Promise(resolve => background.socket.once('close', resolve));
		if (killed) owner.kill('SIGKILL'); else owner.stdin.end();
		assert.deepEqual(await exited, killed ? [null, 'SIGKILL'] : [0, null], stderr);
		await backgroundClosed;
		// Acquiring is nonblocking. Wait for asynchronous supervisor teardown,
		// never remove its lock or guess ownership from a pid/mtime.
		let next;
		for (let attempt = 0; attempt !== 100; ++attempt) {
			try { next = await CodexProfile.acquire(root); break; }
			catch (error) { assert.match(error.message, /Another Studio owns/); await setTimeout(10); }
		}
		assert.ok(next, 'kernel lock is released after descendant join');
		try { await assertProcessExited(background.pid); }
		finally { await next.release(); }
	});

for (const [mode, pattern] of [['malformed', /JSON|property name/], ['unknown', /unknown or completed/], ['crash', /exited \(17/]]) {
	test(`${mode} retires connection rights and every outstanding response`, async t => {
		const rpc = await connect(t, mode);
		await assert.rejects(Promise.all([rpc.request('one', {}), rpc.request('two', {})]), pattern);
		assert.equal(rpc.signal.aborted, true, 'rights retire at failure, not after process join');
		await assert.rejects(rpc.request('late', {}));
		assert.ok((await rpc.stop()).error);
	});
}

test('closing with pending requests rejects immediately and EOF drains the process', async t => {
	const rpc = await connect(t, 'eof');
	const pending = assert.rejects(rpc.request('pending', {}), /closed/);
	const stopping = rpc.stop();
	assert.equal(rpc.signal.aborted, true);
	await pending;
	const exit = await stopping;
	assert.equal(exit.code, 0); assert.equal(exit.forced, false);
});

test('a hung external process is retired on timeout and reported as forced, never as graceful success', async t => {
	const rpc = await connect(t, 'hang', () => {}, 100);
	await assert.rejects(rpc.request('hang', {}), /timed out/);
	assert.equal(rpc.signal.aborted, true);
	const exit = await rpc.stop();
	assert.equal(exit.forced, true);
	if (process.platform === 'win32') assert.equal(exit.code, 1);
	else assert.equal(exit.signal, constants.signals.SIGKILL);
	assert.ok(exit.error);
});

test('failed process launch settles outstanding requests and joins OS close', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-stdio-launch-'));
	const profile = await CodexProfile.acquire(root);
	const rpc = new CodexStdio(profile.scope, '/bmsx-no-such-executable', [], process.cwd(), {}, () => {});
	t.after(async () => { await rpc.stop(); await profile.release(); await rm(root, { recursive: true }); });
	await assert.rejects(rpc.request('initialize', {}), { code: 'ENOENT' });
	assert.equal(rpc.signal.aborted, true);
	assert.equal((await rpc.stop()).forced, false);
});

test('external framing rejects malformed identities and ambiguous responses without internal DTO validation', () => {
	for (const frame of ['null', '[]', '1', '{"id":{}}', '{"id":1,"result":null,"error":{}}', '{"result":null}',
		'{"method":1}', '{"method":"x","result":null}', '{"id":1,"error":0}', '{"id":1,"error":{}}']) assert.throws(() => parseRpcMessage(frame));
	assert.deepEqual(parseRpcMessage('{"id":1,"method":"item/tool/call","params":{}}'), { id: 1, method: 'item/tool/call', params: {} });
});
