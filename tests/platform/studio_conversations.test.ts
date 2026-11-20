import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createStudioServer } from '../helpers/studio_server.mjs';
import { createSharedCodexFixture } from '../helpers/codex_shared_server';
import { createCodexModelFixture, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { openBrowserTestPage, pressStudioChord, waitForBrowserFrame } from '../helpers/browser_test_pages';

const reply = 'The response belongs to the native conversation.';

test('an unavailable native Codex daemon cannot take down the Studio server', { timeout: 15000 }, async t => {
	const server = await createStudioServer(t);
	for (let attempt = 0; attempt < 2; attempt++) {
		const viewer = await fetch(`${server.address}/__bmsx__/conversations/connect`, { method: 'POST', headers: server.headers });
		assert.equal(viewer.status, 503);
		await viewer.text();
		const session = await fetch(`${server.address}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' } });
		assert.equal(session.status, 200);
		await session.body!.cancel();
	}
	await assert.rejects(access(server.trace), { code: 'ENOENT' });
});

test('real Studio: choose the native conversation, follow work, resize and close without controlling CLI', { timeout: 20_000 }, async t => {
	let awaiting: string | undefined = 'the first offline Codex turn';
	t.signal.addEventListener('abort', () => {
		if (awaiting !== undefined) t.diagnostic(`Still waiting for ${awaiting}`);
	}, { once: true });
	const working = Promise.withResolvers<void>();
	const model = await createCodexModelFixture(t, [[{ type: 'message', id: 'first-answer', role: 'assistant', content: [{ type: 'output_text', text: reply }] }],
		() => { working.resolve(); return CODEX_FIXTURE_WAIT; }]);
	const native = await createSharedCodexFixture(t, model.url);
	const { thread } = await native.owner.request<any>('thread/start', { cwd: native.workspace, ephemeral: false, approvalPolicy: 'never', sandbox: 'read-only' });
	await native.owner.request('thread/name/set', { threadId: thread.id, name: 'Studio shared conversation' });
	const first = await native.owner.request<any>('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Can we follow **this conversation** inside Studio?', text_elements: [] }] });
	await native.wait(message => message.method === 'turn/completed' && (message.params as any).turn.id === first.turn.id);
	awaiting = 'browser Studio to connect and boot';
	const server = await createStudioServer(t, { codexHome: native.home });
	const endpoint = `${server.address}/__bmsx__/conversations`;
	assert.equal((await fetch(`${endpoint}/connect`, { method: 'POST' })).status, 401);
	assert.equal((await fetch(`${endpoint}/connect`, { method: 'POST', headers: { ...server.headers, Origin: 'https://untrusted.example' } })).status, 403);
	const page = await openBrowserTestPage(t, { viewport: { width: 1024, height: 768 } });
	const errors: string[] = [], commands: string[] = [], embedded: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	page.on('request', request => {
		if (request.url().endsWith('/conversations/command')) commands.push(request.postDataJSON().type);
		if (request.url().includes('/assistant/')) embedded.push(request.url());
	});
	const ready = page.waitForResponse(response => response.url().endsWith('/studio/connect'));
	await page.goto(`${server.address}/studio.debug.html?rom=studio_test.debug.rom`);
	assert.equal((await ready).status(), 200);
	await page.waitForFunction(() => document.body.classList.contains('game-started'));
	awaiting = 'the conversation history command';
	await pressStudioChord(page, 'ControlRight+ShiftRight');
	await pressStudioChord(page, 'Control+Shift+p');
	await page.keyboard.type('Codex CLI Choose Conversation');
	const history = page.waitForResponse(response => response.url().endsWith('/conversations/command') && response.request().postDataJSON().type === 'history');
	await pressStudioChord(page, 'Enter');
	assert.equal((await history).status(), 200);
	awaiting = 'the conversation open command';
	const selected = page.waitForResponse(response => response.url().endsWith('/conversations/command') && response.request().postDataJSON().type === 'open');
	await pressStudioChord(page, 'Enter');
	assert.equal((await selected).status(), 204);
	awaiting = 'the second offline Codex turn to start';
	const next = await native.owner.request<any>('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Keep working while I inspect the Studio view.', text_elements: [] }] });
	await working.promise;
	awaiting = 'closing the viewer without interrupting the native turn';
	await page.setViewportSize({ width: 390, height: 844 });
	await waitForBrowserFrame(page);
	await page.close();

	const status = await native.owner.request<any>('thread/read', { threadId: thread.id, includeTurns: false });
	assert.equal(status.thread.status.type, 'active');
	await native.owner.request('turn/interrupt', { threadId: thread.id, turnId: next.turn.id });
	assert.deepEqual(commands, ['history', 'open'], 'rendering, resizing and closing the observer cannot write to or poll the agent');
	assert.deepEqual(embedded, []); assert.deepEqual(errors, []);
	await assert.rejects(access(server.trace), { code: 'ENOENT' });
	await assert.rejects(access(join(server.root, 'state')), { code: 'ENOENT' });
	assert.equal(model.requests.length, 2);
	awaiting = undefined;
});
