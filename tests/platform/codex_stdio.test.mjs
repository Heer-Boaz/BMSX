import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CodexStdio } from '../../hosts/node/codex/stdio.ts';
import { parseRpcMessage } from '../../hosts/node/codex/protocol.ts';
import { CodexProfile } from '../../hosts/node/codex/profile.ts';
import { CodexPolicy } from '../../hosts/node/codex/policy.ts';

const peer = fileURLToPath(new URL('../helpers/codex_stdio_peer.mjs', import.meta.url));
const execute = promisify(execFile);
function connect(t, mode, receive = () => {}, timeout = 1000, args = []) {
	const rpc = new CodexStdio(process.execPath, [peer, mode, ...args], process.cwd(), {}, receive, timeout, 100);
	t.after(() => rpc.stop());
	return rpc;
}

test('request multiplexing drains a notification burst and a nested server request without waiting on the first response', async t => {
	let tool, deltas = 0;
	const rpc = connect(t, 'multiplex', message => {
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

async function backgroundObserver(t) {
	const connected = Promise.withResolvers();
	const sockets = new Set();
	const server = createServer(socket => {
		sockets.add(socket);
		createInterface({ input: socket }).once('line', data => connected.resolve({ socket, ...JSON.parse(data) }));
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
	const { stdout } = await execute('ps', ['-A', '-o', 'pid=,stat=']);
	const member = stdout.split('\n').map(line => line.trim().split(/\s+/)).find(fields => Number(fields[0]) === pid);
	assert.ok(member === undefined || member[1][0] === 'Z' || member[1][0] === 'X', `process ${pid} still executes after closed`);
}

for (const mode of ['scope-eof', 'scope-crash', 'scope-hang']) {
	test(`${mode}: shutdown joins background children, including children that inherit the RPC pipes`,
		{ skip: process.platform === 'win32', timeout: 10000 }, async t => {
			const observer = await backgroundObserver(t);
			const rpc = connect(t, mode, () => {}, 1000, [String(observer.port)]);
			const pid = await rpc.request('spawn', {});
			const background = await observer.connected;
			assert.equal(background.pid, pid);
			if (mode === 'scope-crash') {
				rpc.setOutputPaused(true);
				await assert.rejects(rpc.request('crash', {}), /exited \(17/);
			}
			const exit = await rpc.stop();
			assert.equal(exit.forced, mode === 'scope-hang');
			await assertProcessExited(pid);
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
		const rpc = new CodexStdio('codex', policy.args, profile.cwd, profile.env, () => {});
		t.after(async () => { await rpc.stop(); await profile.release(); await rm(root, { recursive: true }); });
		await rpc.request('initialize', { clientInfo: { name: 'bmsx_process_fixture', version: '1' },
			capabilities: { experimentalApi: true } });
		rpc.send({ method: 'initialized', params: {} });
		const background = await observer.connected;
		const exit = await rpc.stop();
		assert.equal(exit.code, 0); assert.equal(exit.forced, false);
		await assertProcessExited(background.pid);
	});

test('abrupt host exit terminates the owned group without pretending its profile lease was joined',
	{ skip: process.platform === 'win32', timeout: 10000 }, async t => {
		const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-owner-'));
		const observer = await backgroundObserver(t);
		const owner = spawn(process.execPath, ['--import', 'tsx', peer, 'owner-exit', root, String(observer.port)],
			{ stdio: ['pipe', 'ignore', 'pipe'] });
		const exited = once(owner, 'close');
		let stderr = ''; owner.stderr.on('data', data => { stderr += data; });
		t.after(async () => { owner.stdin.end(); await exited; await rm(root, { recursive: true }); });
		const background = await observer.connected;
		const backgroundClosed = once(background.socket, 'close');
		owner.stdin.end();
		assert.deepEqual(await exited, [0, null], stderr);
		await backgroundClosed;
		await assert.rejects(CodexProfile.acquire(root), /Another Studio owns the Codex account profile/);
	});

for (const [mode, pattern] of [['malformed', /JSON|property name/], ['unknown', /unknown or completed/], ['crash', /exited \(17/]]) {
	test(`${mode} retires connection rights and every outstanding response`, async t => {
		const rpc = connect(t, mode);
		await assert.rejects(Promise.all([rpc.request('one', {}), rpc.request('two', {})]), pattern);
		assert.equal(rpc.signal.aborted, true, 'rights retire at failure, not after process join');
		await assert.rejects(rpc.request('late', {}));
		assert.ok((await rpc.stop()).error);
	});
}

test('closing with pending requests rejects immediately and EOF drains the process', async t => {
	const rpc = connect(t, 'eof');
	const pending = assert.rejects(rpc.request('pending', {}), /closed/);
	const stopping = rpc.stop();
	assert.equal(rpc.signal.aborted, true);
	await pending;
	const exit = await stopping;
	assert.equal(exit.code, 0); assert.equal(exit.forced, false);
});

test('a hung external process is retired on timeout and reported as forced, never as graceful success', async t => {
	const rpc = connect(t, 'hang', () => {}, 100);
	await assert.rejects(rpc.request('hang', {}), /timed out/);
	assert.equal(rpc.signal.aborted, true);
	const exit = await rpc.stop();
	assert.equal(exit.forced, true); assert.equal(exit.signal, 'SIGKILL'); assert.ok(exit.error);
});

test('failed process launch settles outstanding requests and joins OS close', async () => {
	const rpc = new CodexStdio('/bmsx-no-such-executable', [], process.cwd(), {}, () => {});
	await assert.rejects(rpc.request('initialize', {}), { code: 'ENOENT' });
	assert.equal(rpc.signal.aborted, true);
	assert.equal((await rpc.stop()).forced, false);
});

test('external framing rejects malformed identities and ambiguous responses without internal DTO validation', () => {
	for (const frame of ['null', '[]', '1', '{"id":{}}', '{"id":1,"result":null,"error":{}}', '{"result":null}',
		'{"method":1}', '{"method":"x","result":null}', '{"id":1,"error":0}', '{"id":1,"error":{}}']) assert.throws(() => parseRpcMessage(frame));
	assert.deepEqual(parseRpcMessage('{"id":1,"method":"item/tool/call","params":{}}'), { id: 1, method: 'item/tool/call', params: {} });
});
