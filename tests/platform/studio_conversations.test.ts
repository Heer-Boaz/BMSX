import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createStudioServer } from '../helpers/studio_server.mjs';
import { createSharedCodexFixture } from '../helpers/codex_shared_server';
import { createCodexModelFixture, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';

const reply = '# Shared conversation\n\n**One thread**, shown in the CLI and Studio. No copy or fork.\n\nThe CLI can use `studio_evaluate_lua`, inspect actors and step frames through MCP.\n\n```lua\nreturn 6 * 7\n```\n\n- Studio is *read only* here.\n- The existing Studio assistant remains available.\n- Ordinary words wrap without splitting.';

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

test('server status follows the live Studio channel independently of the Codex daemon and active pane', { timeout: 60000 }, async t => {
	const server = await createStudioServer(t);
	const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
		'--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
	const errors: string[] = [], requests: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	page.on('request', request => { if (request.url().includes('/__bmsx__/') && !request.url().includes('/lua')) requests.push(new URL(request.url()).pathname); });
	const gate = Promise.withResolvers<void>(), opening = Promise.withResolvers<void>();
	await page.route('**/__bmsx__/studio/connect', async route => { opening.resolve(); await gate.promise; await route.continue(); });
	const registered = page.waitForResponse(response => response.url().endsWith('/studio/connect'));
	await page.goto(`${server.address}/studio.debug.html?rom=nemesis_s.debug.rom`); await opening.promise;
	const evidence = '/tmp/bmsx-studio-connection'; await mkdir(evidence, { recursive: true });
	const press = async (keys: string) => { await page.keyboard.press(keys, { delay: 100 });
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); };
	const command = async (title: string) => { await press('Control+Shift+p'); await page.keyboard.type(title, { delay: 25 }); await press('Enter'); };
	await press('ControlRight+ShiftRight');
	await page.screenshot({ path: join(evidence, 'connecting.png') });
	gate.resolve(); assert.equal((await registered).status(), 200);
	await press('Escape'); await page.screenshot({ path: join(evidence, 'connected-editor.png') });
	await press('Control+Alt+t'); await page.screenshot({ path: join(evidence, 'connected-dark.png') }); await press('Control+Alt+t');
	await press('Control+b'); await page.screenshot({ path: join(evidence, 'connected-resources.png') }); await press('Control+b');
	const unavailable = page.waitForResponse(response => response.url().endsWith('/conversations/connect'));
	await command('Codex CLI Choose Conversation'); assert.equal((await unavailable).status(), 503);
	await page.screenshot({ path: join(evidence, 'daemon-unavailable-server-connected.png') });
	await command('Codex Assistant'); await page.screenshot({ path: join(evidence, 'connected-assistant.png') });
	const disconnected = page.waitForEvent('console', { predicate: message => message.text().includes('Studio external tools unavailable:') });
	server.process.kill('SIGKILL'); await disconnected;
	await press('Escape'); await page.screenshot({ path: join(evidence, 'disconnected-assistant.png') });
	await press('Control+Alt+t'); await page.screenshot({ path: join(evidence, 'disconnected-dark.png') }); await press('Control+Alt+t');
	await command('Lua Terminal'); await page.screenshot({ path: join(evidence, 'disconnected-terminal.png') });
	assert.deepEqual(errors, []);
	assert.deepEqual(requests, ['/__bmsx__/session', '/__bmsx__/studio/connect', '/__bmsx__/conversations/connect'],
		'connection chrome and pane changes do not poll, retry, log in or start the embedded agent');
	await assert.rejects(access(server.trace), { code: 'ENOENT' });
});

test('real Studio: choose the native conversation, follow work, resize and close without controlling CLI', { timeout: 90000 }, async t => {
	let browser: Browser;
	t.after(async () => { await browser?.close(); });
	const working = Promise.withResolvers<void>();
	const model = await createCodexModelFixture(t, [[{ type: 'message', id: 'first-answer', role: 'assistant', content: [{ type: 'output_text', text: reply }] }],
		() => { working.resolve(); return CODEX_FIXTURE_WAIT; }]);
	const native = await createSharedCodexFixture(t, model.url);
	const { thread } = await native.owner.request<any>('thread/start', { cwd: native.workspace, ephemeral: false, approvalPolicy: 'never', sandbox: 'read-only' });
	await native.owner.request('thread/name/set', { threadId: thread.id, name: 'Studio shared conversation' });
	const first = await native.owner.request<any>('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Can we follow **this conversation** inside Studio?', text_elements: [] }] });
	await native.wait(message => message.method === 'turn/completed' && (message.params as any).turn.id === first.turn.id);
	const server = await createStudioServer(t, { codexHome: native.home });
	const endpoint = `${server.address}/__bmsx__/conversations`;
	assert.equal((await fetch(`${endpoint}/connect`, { method: 'POST' })).status, 401);
	assert.equal((await fetch(`${endpoint}/connect`, { method: 'POST', headers: { ...server.headers, Origin: 'https://untrusted.example' } })).status, 403);
	const evidence = '/tmp/bmsx-studio-conversations'; await mkdir(evidence, { recursive: true });
	browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
		'--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
	const errors: string[] = [], commands: string[] = [], embedded: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	page.on('request', request => {
		if (request.url().endsWith('/conversations/command')) commands.push(request.postDataJSON().type);
		if (request.url().includes('/assistant/')) embedded.push(request.url());
	});
	const ready = page.waitForResponse(response => response.url().endsWith('/studio/connect'));
	await page.goto(`${server.address}/studio.debug.html?rom=nemesis_s.debug.rom`); await ready;
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await page.keyboard.press('ControlRight+ShiftRight', { delay: 100 });
	await page.keyboard.press('Control+Shift+p', { delay: 100 });
	// History is a workbench action: the initial focus is still the Lua editor.
	await page.keyboard.type('Codex CLI Choose Conversation', { delay: 25 });
	await page.screenshot({ path: join(evidence, 'command.png') });
	const history = page.waitForResponse(response => response.url().endsWith('/conversations/command') && response.request().postDataJSON().type === 'history');
	await page.keyboard.press('Enter', { delay: 100 });
	assert.equal((await history).status(), 200);
	await page.screenshot({ path: join(evidence, 'history.png') });
	const selected = page.waitForResponse(response => response.url().endsWith('/conversations/command') && response.request().postDataJSON().type === 'open');
	await page.keyboard.press('Enter', { delay: 100 });
	assert.equal((await selected).status(), 204);
	await page.screenshot({ path: join(evidence, 'conversation.png') });
	const next = await native.owner.request<any>('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Keep working while I inspect the Studio view.', text_elements: [] }] });
	await working.promise;
	await page.screenshot({ path: join(evidence, 'working.png') });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: join(evidence, 'resized.png') });
	await page.setViewportSize({ width: 1024, height: 768 });
	// Exercise actual UI recovery after a terminal lease rejection, not an automatic retry.
	await page.route('**/__bmsx__/conversations/command', route => route.fulfill({ status: 410, contentType: 'text/plain', body: 'Viewer lease ended for the connection-loss probe' }), { times: 1 });
	await page.keyboard.press('Control+Shift+p', { delay: 100 });
	await page.keyboard.type('Codex CLI Conversations', { delay: 25 });
	const retired = page.waitForResponse(response => response.url().endsWith('/conversations/command') && response.status() === 410);
	await page.keyboard.press('Enter', { delay: 100 }); await retired;
	await page.screenshot({ path: join(evidence, 'disconnected.png') });
	await page.close();

	// A fresh narrow browser gets its own viewer; it does not reuse the desktop's canvas layout or lease.
	const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	phone.on('pageerror', error => errors.push(String(error)));
	const phoneReady = phone.waitForResponse(response => response.url().endsWith('/studio/connect'));
	await phone.goto(`${server.address}/studio.debug.html?rom=nemesis_s.debug.rom`); await phoneReady;
	await phone.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await phone.keyboard.press('ControlRight+ShiftRight', { delay: 100 });
	await phone.keyboard.press('Control+Shift+p', { delay: 100 });
	await phone.keyboard.type('Codex CLI Conversations', { delay: 25 });
	const phoneHistory = phone.waitForResponse(response => response.url().endsWith('/conversations/command') && response.request().postDataJSON().type === 'history');
	await phone.keyboard.press('Enter', { delay: 100 }); assert.equal((await phoneHistory).status(), 200);
	const phoneSelected = phone.waitForResponse(response => response.url().endsWith('/conversations/command') && response.request().postDataJSON().type === 'open');
	await phone.keyboard.press('Enter', { delay: 100 }); assert.equal((await phoneSelected).status(), 204);
	await phone.screenshot({ path: join(evidence, 'phone.png') });
	await phone.close();
	const status = await native.owner.request<any>('thread/read', { threadId: thread.id, includeTurns: false });
	assert.equal(status.thread.status.type, 'active');
	await native.owner.request('turn/interrupt', { threadId: thread.id, turnId: next.turn.id });
	assert.deepEqual(commands, ['history', 'open', 'history'], 'rendering, streaming, resize and connection failure cannot write, retry or poll the agent');
	assert.deepEqual(embedded, []); assert.deepEqual(errors, []);
	await assert.rejects(access(server.trace), { code: 'ENOENT' });
	await assert.rejects(access(join(server.root, 'state')), { code: 'ENOENT' });
	assert.equal(model.requests.length, 2);
});
