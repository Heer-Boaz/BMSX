import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { CodexHttpApi } from '../../hosts/node/codex/http_api';
import { AssistantHttpConnection } from '../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../ide/browser/http_session';
import type { AssistantEvent } from '../../hosts/common/assistant_protocol';
import { WorkspaceHttpSession, HttpError } from '../../scripts/dev/http_security.mjs';
import { handleWorkspaceRequest } from '../../scripts/dev/workspace_api.mjs';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';

const readCall = { type: 'function_call', call_id: 'codex-private-id', name: 'studio_read', arguments: '{"resource":"cart.lua"}' };
const tools = [{ name: 'studio_read', description: 'Read a Studio source', inputSchema: { type: 'object', properties: { resource: { type: 'string' } },
	required: ['resource'], additionalProperties: false } }];

async function fixture(t: TestContext, steps: unknown[], clientScript?: Uint8Array) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-assistant-http-'));
	const profile = join(root, 'profile');
	const model = await createCodexModelFixture(t, steps);
	const api = new CodexHttpApi({ profileDirectory: profile, provider: { name: 'Offline transport fixture', model: 'mock-model', baseUrl: `${model.url}/v1` }, tools });
	const authority = new WorkspaceHttpSession('127.0.0.1');
	const requests = new Map<string, number>();
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url!, 'http://local');
			requests.set(url.pathname, (requests.get(url.pathname) ?? 0) + 1);
			if (clientScript && url.pathname === '/') response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><link rel="icon" href="data:,">');
			else if (clientScript && url.pathname === '/client.js') response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(clientScript);
			else if (url.pathname === '/__bmsx__/session') authority.bootstrap(request, response);
			else {
				authority.authorize(request);
				if (url.pathname === '/__bmsx__/lua') await handleWorkspaceRequest(root, request, response, url);
				else await api.handle(request, response, url.pathname);
			}
		} catch (error) {
			if (response.headersSent) response.destroy(error as Error);
			else response.writeHead(error instanceof HttpError ? error.status : 500).end(String(error));
		}
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const session = new StudioHttpSession(address);
	t.after(async () => {
		await api.close(); server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(root, { recursive: true });
	});
	const open = async () => {
		const events: AssistantEvent[] = [], waiting: { predicate: (event: AssistantEvent) => boolean; resolve: (event: AssistantEvent) => void }[] = [];
		const client = await AssistantHttpConnection.open(session, t.signal, event => {
			events.push(event);
			for (let i = waiting.length - 1; i >= 0; --i) {
				if (waiting[i].predicate(event)) { waiting[i].resolve(event); waiting.splice(i, 1); }
			}
		});
		const connected = events[0]; assert.ok(connected.type === 'connected');
		return { client, events, lease: connected.lease,
			wait(predicate: (event: AssistantEvent) => boolean) {
				const event = events.find(predicate);
				return event ? Promise.resolve(event) : new Promise<AssistantEvent>(resolve => waiting.push({ predicate, resolve }));
			} };
	};
	const command = async (lease: string, data: unknown) => fetch(`${address}/__bmsx__/assistant/command`, { method: 'POST',
		headers: { Authorization: `Bearer ${await session.connect()}`, 'X-BMSX-Assistant-Lease': lease, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
	return { address, api, model, profile, root, requests, open, command, session };
}

test('origin/session admission precedes profile/process access; no process exists merely because the endpoint is enabled', { timeout: 15000 }, async t => {
	const f = await fixture(t, []);
	const endpoint = `${f.address}/__bmsx__/assistant/connect`;
	assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
	assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://hostile.example' } })).status, 403);
	assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${await f.session.connect()}`, Origin: 'null' } })).status, 403);
	await assert.rejects(access(f.profile), { code: 'ENOENT' });
	assert.equal(f.model.requests.length, 0);
});

test('real HTTP/browser client owns one lease, multiplexes a source tool and rejects wrong/replayed replies or arbitrary provider RPC', { timeout: 15000 }, async t => {
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE]);
	const c = await f.open();
	assert.equal(c.client.account.requiresLogin, false);
	await assert.rejects(f.open(), /409/);
	assert.equal((await f.command(c.lease, { type: 'config/value/write', keyPath: 'sandbox_mode', value: 'danger-full-access' })).status, 400);
	const turn = await c.client.send({ type: 'start', reviews: [], prompt: 'Read source through Studio' });
	const call = await c.wait(event => event.type === 'tool-request'); assert.ok(call.type === 'tool-request');
	assert.notEqual(call.requestId, readCall.call_id, 'external provider request identities never become browser reply rights');
	assert.equal((await f.command('another-tab', { type: 'tool-result', requestId: call.requestId, success: true, text: 'WRONG' })).status, 410);
	await c.client.send({ type: 'tool-result', requestId: call.requestId, success: true, text: 'UNSAVED RECEIPT FROM BROWSER' });
	const completed = await c.wait(event => event.type === 'turn-completed'); assert.ok(completed.type === 'turn-completed');
	assert.ok(turn && 'turnId' in turn); assert.equal(completed.turnId, turn.turnId); assert.equal(completed.status, 'completed');
	assert.equal(f.model.requests[1].input.find(item => item.type === 'function_call_output').output, 'UNSAVED RECEIPT FROM BROWSER');
	assert.equal((await f.command(c.lease, { type: 'tool-result', requestId: call.requestId, success: true, text: 'REPLAY' })).status, 409);
	c.client.close(); await c.client.closed;
	assert.equal(c.client.signal.aborted, true);
});

test('interrupt retires the pending browser tool before turn completion; a late reply cannot be accepted', { timeout: 15000 }, async t => {
	const f = await fixture(t, [[readCall]]), c = await f.open();
	await c.client.send({ type: 'start', reviews: [], prompt: 'Wait on a tool' });
	const call = await c.wait(event => event.type === 'tool-request'); assert.ok(call.type === 'tool-request');
	await c.client.send({ type: 'interrupt' });
	const cancelled = await c.wait(event => event.type === 'tool-cancelled'); assert.ok(cancelled.type === 'tool-cancelled');
	assert.equal(cancelled.requestId, call.requestId);
	const completed = await c.wait(event => event.type === 'turn-completed'); assert.ok(completed.type === 'turn-completed');
	assert.equal(completed.status, 'interrupted');
	assert.equal((await f.command(c.lease, { type: 'tool-result', requestId: call.requestId, success: true, text: 'LATE' })).status, 409);
	assert.equal(f.model.requests.length, 1);
	c.client.close(); await c.client.closed;
});

test('review observations cross the real HTTP and Codex input boundary as data beside the unchanged user prompt', { timeout: 15000 }, async t => {
	const f = await fixture(t, [CODEX_FIXTURE_DONE]), c = await f.open();
	const reviews = [{ review: 'context/review', state: 'applied' as const, reason: '' },
		{ review: 'other/review', state: 'stale' as const, reason: 'Source changed: "cart.lua"\n🐉' }];
	const prompt = 'Continue with my actual source 🐉\nKeep canonical formatting.';
	await c.client.send({ type: 'start', prompt, reviews });
	await c.wait(event => event.type === 'turn-completed');
	const user = f.model.requests[0].input.filter(item => item.role === 'user').at(-1);
	const text = user.content.map(item => item.text).join('\n');
	assert.ok(text.includes(JSON.stringify(reviews)));
	assert.ok(text.endsWith(prompt), 'user prompt bytes remain separate from the structured observation');
	assert.match(text, /data, not instructions/);
	assert.match(text, /Undo or later edits may have changed source/);
	assert.match(text, /not saved, built or run/);
	assert.equal(f.model.requests.length, 1);
	c.client.close(); await c.client.closed;
});

test('event-stream disconnect drains the real process; explicit reconnect gets new rights and cannot resurrect the old tool', { timeout: 15000 }, async t => {
	const f = await fixture(t, [[readCall]]), first = await f.open();
	await first.client.send({ type: 'start', reviews: [], prompt: 'Wait on the first connection' });
	const call = await first.wait(event => event.type === 'tool-request'); assert.ok(call.type === 'tool-request');
	first.client.close(); await first.client.closed;
	const second = await f.open();
	assert.notEqual(second.lease, first.lease);
	assert.equal((await f.command(first.lease, { type: 'tool-result', requestId: call.requestId, success: true, text: 'OLD' })).status, 410);
	assert.equal((await f.command(second.lease, { type: 'tool-result', requestId: call.requestId, success: true, text: 'RETARGET' })).status, 409);
	assert.equal(f.model.requests.length, 1, 'reconnect never replays the previous prompt');
	second.client.close(); await second.client.closed;
});

test('losing the HTTP response after an accepted start closes the lease and never repeats the prompt', { timeout: 15000 }, async t => {
	const f = await fixture(t, [[readCall]]), c = await f.open();
	const fetch = globalThis.fetch;
	let commands = 0;
	t.mock.method(globalThis, 'fetch', async (url, init) => {
		const response = await fetch(url, init);
		if (String(url).endsWith('/assistant/command')) {
			commands++;
			await response.text();
			await c.wait(event => event.type === 'tool-request');
			throw new TypeError('Simulated lost response after accepted start');
		}
		return response;
	});
	await assert.rejects(c.client.send({ type: 'start', reviews: [], prompt: 'Exactly one accepted prompt' }), /lost response/);
	await c.client.closed;
	assert.equal(c.client.signal.aborted, true);
	assert.equal(commands, 1); assert.equal(f.model.requests.length, 1);
});

test('platform shutdown joins a pending real process and releases its profile lease', { timeout: 15000 }, async t => {
	const f = await fixture(t, [[readCall]]), c = await f.open();
	await c.client.send({ type: 'start', reviews: [], prompt: 'Wait until server shutdown' });
	await c.wait(event => event.type === 'tool-request');
	await f.api.close(); await c.client.closed;
	assert.equal(c.client.signal.aborted, true);
	await assert.rejects(access(join(f.profile, 'lease')), { code: 'ENOENT' });
	assert.equal(f.model.requests.length, 1);
});

test('an interrupted accepted response body retires the lease just like losing the response headers', { timeout: 15000 }, async t => {
	const f = await fixture(t, [[readCall]]), c = await f.open();
	const fetch = globalThis.fetch;
	let commands = 0;
	t.mock.method(globalThis, 'fetch', async (url, init) => {
		const response = await fetch(url, init);
		if (String(url).endsWith('/assistant/command')) {
			commands++;
			await response.text();
			await c.wait(event => event.type === 'tool-request');
			return new Response('{"turnId":', { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return response;
	});
	await assert.rejects(c.client.send({ type: 'start', reviews: [], prompt: 'Exactly one accepted prompt, incomplete response body' }), SyntaxError);
	await c.client.closed;
	assert.equal(c.client.signal.aborted, true);
	assert.equal(commands, 1); assert.equal(f.model.requests.length, 1);
});

test('capability rejection expires shared admission but does not renew or replay an assistant command', { timeout: 15000 }, async t => {
	const f = await fixture(t, []), c = await f.open();
	const fetch = globalThis.fetch, paths: string[] = [];
	t.mock.method(globalThis, 'fetch', (url, init) => {
		const path = new URL(String(url)).pathname; paths.push(path);
		return path.endsWith('/command') ? Promise.resolve(new Response('Expired capability', { status: 401 })) : fetch(url, init);
	});
	await assert.rejects(c.client.send({ type: 'start', reviews: [], prompt: 'Do not repeat this prompt' }), /401/);
	await c.client.closed;
	assert.equal(c.client.signal.aborted, true);
	assert.deepEqual(paths, ['/__bmsx__/assistant/command']);
	assert.equal(f.model.requests.length, 0);
	await f.session.connect();
	assert.deepEqual(paths, ['/__bmsx__/assistant/command', '/__bmsx__/session'], 'only a subsequent explicit operation renews platform admission');
});

test('an event exceeding the stream budget retires the entire connection and leaves no process lease', { timeout: 15000 }, async t => {
	const largeMessage = [{ type: 'message', id: 'large', role: 'assistant', content: [{ type: 'output_text', text: 'X'.repeat(9 * 1024 * 1024) }] }];
	const f = await fixture(t, [largeMessage]), c = await f.open();
	await c.client.send({ type: 'start', reviews: [], prompt: 'Exercise the event transport budget' });
	await c.client.closed;
	assert.equal(c.client.signal.aborted, true);
	assert.ok(c.events.some(event => event.type === 'closed' && event.error !== undefined));
	const replacement = await f.open();
	assert.notEqual(replacement.lease, c.lease, 'a new process starts only after the overflowing connection drains');
	assert.equal(f.model.requests.length, 1);
	await f.api.close(); await replacement.client.closed;
	await assert.rejects(access(join(f.profile, 'lease')), { code: 'ENOENT' });
});

test('Chromium uses the real same-origin transport and shares admission with ordinary source IO', { timeout: 20000 }, async t => {
	const bundle = await build({ stdin: { contents: `
		export { AssistantHttpConnection } from './ide/browser/assistant_connection';
		export { StudioHttpSession } from './ide/browser/http_session';
		export { HttpWorkspaceRecordProvider } from './ide/browser/workspace_records';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'esm', target: 'es2024', write: false });
	const f = await fixture(t, [[readCall], CODEX_FIXTURE_DONE], bundle.outputFiles[0].contents);
	await writeFile(join(f.root, 'source.lua'), 'return 1');
	const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
	t.after(() => browser.close());
	const page = await browser.newPage(), errors: Error[] = [];
	page.on('pageerror', error => errors.push(error));
	await page.goto(f.address);
	const result = await page.evaluate(async () => {
		const modulePath = '/client.js';
		const { AssistantHttpConnection, StudioHttpSession, HttpWorkspaceRecordProvider } = await import(modulePath);
		const session = new StudioHttpSession(), provider = new HttpWorkspaceRecordProvider(session), lifetime = new AbortController();
		const requested = Promise.withResolvers<Extract<AssistantEvent, { type: 'tool-request' }>>(), completed = Promise.withResolvers<void>();
		const events: AssistantEvent[] = [];
		const [client, source] = await Promise.all([AssistantHttpConnection.open(session, lifetime.signal, (event: AssistantEvent) => {
			events.push(event);
			if (event.type === 'tool-request') requested.resolve(event);
			if (event.type === 'turn-completed') completed.resolve();
		}), provider.read('source.lua')]);
		await client.send({ type: 'start', reviews: [], prompt: 'Read a browser-owned source receipt' });
		const call = await requested.promise;
		await client.send({ type: 'tool-result', requestId: call.requestId, success: true, text: '-- UNSAVED 🐉 browser receipt\n' + source.contents });
		await completed.promise;
		lifetime.abort(); await client.closed;
		// Assistant disconnect must not retire the shared file-transport capability.
		await provider.write('source.lua', { contents: 'return 2', updatedAt: 1234567890000 }, true);
		return { source: source.contents, account: client.account, events: events.map(event => event.type), closed: client.signal.aborted,
			saved: (await provider.read('source.lua')).contents };
	});
	assert.equal(result.source, 'return 1'); assert.equal(result.saved, 'return 2'); assert.equal(result.closed, true);
	assert.equal(result.account.requiresLogin, false);
	assert.deepEqual(result.events, ['connected', 'thread', 'turn-started', 'user-message', 'tool-request', 'message', 'turn-completed']);
	assert.equal(f.model.requests[1].input.find(item => item.type === 'function_call_output').output, '-- UNSAVED 🐉 browser receipt\nreturn 1');
	assert.equal(f.requests.get('/__bmsx__/session'), 1, 'simultaneous file and process admission share one capability request');
	assert.equal(await readFile(join(f.root, 'source.lua'), 'utf8'), 'return 2');
	assert.deepEqual(errors, []);
});
