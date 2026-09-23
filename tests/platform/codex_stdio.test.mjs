import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CodexStdio } from '../../hosts/node/codex/stdio.ts';
import { parseRpcMessage } from '../../hosts/node/codex/protocol.ts';

const peer = fileURLToPath(new URL('../helpers/codex_stdio_peer.mjs', import.meta.url));
function connect(t, mode, receive = () => {}, timeout = 1000) {
	const rpc = new CodexStdio(process.execPath, [peer, mode], process.cwd(), {}, receive, timeout, 100);
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
