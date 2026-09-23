import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonLines } from '../../hosts/common/json_lines';
import { AssistantHttpConnection } from '../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../ide/browser/http_session';

test('JSON stream framing preserves split UTF-8, multiple frames and long fragmented lines', async () => {
	const expected = [{ text: '🐉'.repeat(16000) }, { text: 'other\nline' }];
	const bytes = new TextEncoder().encode(expected.map(value => JSON.stringify(value) + '\n').join(''));
	let cursor = 0;
	const stream = new ReadableStream<Uint8Array>({ pull(controller) {
		if (cursor === bytes.length) { controller.close(); return; }
		const end = Math.min(bytes.length, cursor + 257);
		controller.enqueue(bytes.subarray(cursor, end)); cursor = end;
	} });
	const values = []; for await (const value of readJsonLines(stream)) values.push(value);
	assert.deepEqual(values, expected); assert.equal(stream.locked, false);
});

test('truncated/invalid JSON or UTF-8 closes framing rather than dropping or repairing an event', async () => {
	for (const bytes of [new TextEncoder().encode('{"unfinished":true}'), new TextEncoder().encode('not JSON\n'), new Uint8Array([0xff, 10])]) {
		const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
		await assert.rejects(async () => { for await (const _value of readJsonLines(stream)) assert.fail(); });
		assert.equal(stream.locked, false);
	}
});

test('cancelling assistant admission settles open immediately without starting a process after late platform admission', async t => {
	let admit!: (response: Response) => void;
	let requests = 0;
	t.mock.method(globalThis, 'fetch', () => { requests++; return new Promise<Response>(resolve => { admit = resolve; }); });
	const lifetime = new AbortController();
	const opening = AssistantHttpConnection.open(new StudioHttpSession(), lifetime.signal, () => {});
	lifetime.abort(new Error('Workspace replaced while admitting transport'));
	await assert.rejects(opening, /Workspace replaced/);
	admit(Response.json({ workspaceToken: 'local' }));
	await Promise.resolve(); await Promise.resolve();
	assert.equal(requests, 1, 'a cancelled opening cannot proceed to the process endpoint');
});
