import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { chromium, type Browser } from 'playwright';
import { createStudioServer } from '../helpers/studio_server.mjs';
import { createCodexContractFixture } from '../helpers/codex_app_server.mjs';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';

test('CLI MCP uses a real Studio window without its chat: runtime, Lua, frames, images and scoped source review', { timeout: 120000 }, async t => {
	const clients: Client[] = [], transports: StreamableHTTPClientTransport[] = [];
	let browser: Browser;
	t.after(async () => { for (const transport of transports) await transport.terminateSession(); for (const client of clients) await client.close(); await browser?.close(); });
	const f = await createStudioServer(t), endpoint = `${f.address}/__bmsx__/mcp`;
	assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
	assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...f.headers, Origin: 'https://untrusted.example' } })).status, 403);
	const connect = async () => {
		const client = new Client({ name: 'studio-mcp-integration', version: '1.0.0' });
		const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: f.headers } });
		await client.connect(transport); clients.push(client); transports.push(transport); return client;
	};
	const first = await connect(), second = await connect();
	const call = async (name: string, args = {}, client = first) => {
		const result = await client.callTool({ name, arguments: args }) as CallToolResult;
		assert.notEqual(result.isError, true, JSON.stringify(result.content));
		return result.structuredContent!.result as any;
	};
	assert.deepEqual((await call('studio_list_sessions')).sessions, []);
	const catalog = await first.listTools();
	assert.ok(catalog.tools.find(tool => tool.name === 'studio_evaluate_lua')!.inputSchema.properties!.context,
		'Lua evaluation context is distinct from MCP toolContext routing');
	browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-webgpu',
		'--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
		'--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
	const errors: string[] = [], assistantRequests: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	// A new project has no .bmsx/session.json (the storage API returns 404).
	// Browser resource diagnostics are not uncaught application exceptions.
	page.on('console', message => { if (message.type() === 'error') console.log('browser diagnostic', message.text(), message.location()); });
	page.on('request', request => { if (request.url().includes('/__bmsx__/assistant/')) assistantRequests.push(request.url()); });
	const registered = page.waitForResponse(response => response.url().endsWith('/__bmsx__/studio/connect'));
	await page.goto(`${f.address}/studio.debug.html?rom=nemesis_s.debug.rom`);
	assert.equal((await registered).status(), 200);
	const { sessions } = await call('studio_list_sessions');
	assert.equal(sessions.length, 1);
	const { toolContext } = await call('studio_open_context', { session: sessions[0].id });
	const forbidden = await second.callTool({ name: 'studio_runtime_status', arguments: { toolContext } }) as CallToolResult;
	assert.equal(forbidden.isError, true, 'MCP clients cannot borrow another client\'s tool contexts');
	// Window registration publishes the tool endpoint, not completion of the boot operation.
	let status = await call('studio_runtime_status', { toolContext });
	while (status.operationActive) {
		await delay(50);
		status = await call('studio_runtime_status', { toolContext });
	}
	console.log('runtime status', JSON.stringify(status));
	const { target } = status;
	await call('studio_pause_runtime', { toolContext, target });
	// The real BIOS/cart startup has a timed intro. Advance it through the public
	// frame operation, not a test-only scheduler or a guest-state injection.
	const boot = await call('studio_step_frames', { toolContext, target, direction: 'forward', count: 650 });
	assert.equal(boot.status, 'completed');
	const stepped = await call('studio_step_frames', { toolContext, target, direction: 'forward', count: 3 });
	console.log('completed frame stepping', JSON.stringify(stepped));
	assert.equal(stepped.status, 'completed');
	assert.equal(stepped.after.videoTick - stepped.before.videoTick, 3);
	const evaluation = await call('studio_evaluate_lua', { toolContext, target, context: 'cart', source: 'return 6 * 7' });
	console.log('Lua evaluation', JSON.stringify(evaluation));
	assert.equal(evaluation.status, 'completed');
	assert.deepEqual(evaluation.values, ['42']);
	const image = await first.callTool({ name: 'studio_capture_game', arguments: { toolContext, target } }) as CallToolResult;
	assert.notEqual(image.isError, true, JSON.stringify(image.content.filter(item => item.type !== 'image')));
	const frame = image.content.find(item => item.type === 'image')!;
	assert.equal(frame.type, 'image');
	const evidence = '/tmp/bmsx-studio-mcp'; await mkdir(evidence, { recursive: true });
	await writeFile(join(evidence, 'game.png'), Buffer.from(frame.data as string, 'base64'));
	await page.screenshot({ path: join(evidence, 'studio.png') });
	const sources = await call('studio_list_sources', { toolContext });
	const resource = sources.find((source: { domain: number; path: string }) => source.domain === 0 && source.path === 'cart.lua');
	assert.ok(resource);
	const source = await call('studio_read_source', { toolContext, resource: resource.resource });
	const proposal = await call('studio_propose_edits', { toolContext, title: 'MCP source review', files: [{ receipt: source.receipt,
		 edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: '-- MCP review\n' }] }] });
	const review = await call('studio_read_review', { toolContext, review: proposal.review });
	assert.equal(review.state, 'pending');
	await page.screenshot({ path: join(evidence, 'review.png') });
	const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.request().postDataJSON().path === 'carts/nemesis_s/cart.lua');
	await page.mouse.click(860, 88, { delay: 100 });
	await page.screenshot({ path: join(evidence, 'apply-click.png') });
	console.log('source save response', (await saved).status());
	assert.equal((await call('studio_read_review', { toolContext, review: proposal.review })).state, 'applied');
	assert.equal(await readFile(join(f.root, 'carts/nemesis_s/cart.lua'), 'utf8'), `-- MCP review\n${source.source}`);
	await page.screenshot({ path: join(evidence, 'applied.png') });
	await page.mouse.click(90, 60, { delay: 100 });
	await page.mouse.click(500, 280, { delay: 100 });
	await page.keyboard.press('Control+z', { delay: 100 });
	const fresh = await call('studio_open_context', { session: sessions[0].id });
	const latestCatalog = await call('studio_list_sources', fresh);
	const latestCart = latestCatalog.find((source: { domain: number; path: string }) => source.domain === 0 && source.path === 'cart.lua');
	const undone = await call('studio_read_source', { ...fresh, resource: latestCart.resource });
	assert.equal(undone.source, source.source, 'ordinary source-editor Undo reverses an MCP proposal');
	await page.screenshot({ path: join(evidence, 'undone.png') });
	await call('studio_close_context', fresh);
	await call('studio_close_context', { toolContext });
	assert.equal((await first.callTool({ name: 'studio_list_sources', arguments: { toolContext } }) as CallToolResult).isError, true);

	// Native Codex MCP discovery/calls, using the installed executable and no account or model requests.
	const model = await createCodexModelFixture(t, []);
	const codex = await createCodexContractFixture(t, model.url, { mcp: { url: endpoint,
		headersHelper: `node ${JSON.stringify(resolve('scripts/dev/studio-mcp-headers.mjs'))} ${f.address}` } });
	const threadId = await codex.startThread();
	const native = await codex.request('mcpServer/tool/call', { threadId, server: 'bmsx', tool: 'studio_list_sessions', arguments: {} });
	console.log('native Codex MCP session discovery', JSON.stringify(native));
	console.log('native text', native.content[0].text);
	const nativeSessions = native.structuredContent.result;
	assert.equal(nativeSessions.sessions[0].id, sessions[0].id);
	const nativeCall = async (tool: string, args: Record<string, unknown>) => {
		const result = await codex.request('mcpServer/tool/call', { threadId, server: 'bmsx', tool, arguments: args });
		assert.notEqual(result.isError, true, JSON.stringify(result));
		return result.structuredContent.result;
	};
	const nativeContext = await nativeCall('studio_open_context', { session: sessions[0].id });
	assert.equal((await nativeCall('studio_runtime_status', nativeContext)).target, target);
	const nativeLua = await nativeCall('studio_evaluate_lua', { ...nativeContext, target, context: 'cart', source: 'return 21 * 2' });
	assert.equal(nativeLua.status, 'completed'); assert.deepEqual(nativeLua.values, ['42']);
	const nativeImage = await codex.request('mcpServer/tool/call', { threadId, server: 'bmsx', tool: 'studio_capture_game', arguments: { ...nativeContext, target } });
	assert.equal(nativeImage.isError, false);
	assert.ok(nativeImage.content.some((part: { type: string }) => part.type === 'image'));
	console.log('native Codex executed Lua and received a game image');

	const interruptContext = await call('studio_open_context', { session: sessions[0].id });
	const interrupt = new AbortController();
	const operation = first.callTool({ name: 'studio_step_frames', arguments: { ...interruptContext, target, direction: 'forward', count: 10000 } }, undefined, { signal: interrupt.signal });
	const cancelled = assert.rejects(operation);
	let running = await call('studio_runtime_status', interruptContext);
	for (let attempt = 0; !running.history.operationActive && attempt < 20; attempt++) {
		await delay(50); running = await call('studio_runtime_status', interruptContext);
	}
	assert.equal(running.history.operationActive, true);
	interrupt.abort();
	await cancelled;
	// Observe real host-frame completion after cancellation, not an internal model edit.
	let afterCancel = await call('studio_runtime_status', interruptContext);
	for (let attempt = 0; afterCancel.history.operationActive && attempt < 20; attempt++) {
		await delay(50); afterCancel = await call('studio_runtime_status', interruptContext);
	}
	assert.equal(afterCancel.history.operationActive, false);
	assert.equal(afterCancel.userPaused, true);
	const stationary = await call('studio_runtime_status', interruptContext);
	assert.equal(stationary.videoTick, afterCancel.videoTick);
	await call('studio_close_context', interruptContext);
	assert.deepEqual((await nativeCall('studio_evaluate_lua', { ...nativeContext, target, context: 'cart', source: 'return 42' })).values, ['42'],
		'cancelling one MCP request does not retire another client or replay work');

	const other = await browser.newPage();
	const otherRegistered = other.waitForResponse(response => response.url().endsWith('/__bmsx__/studio/connect'));
	await other.goto(`${f.address}/studio.debug.html?rom=nemesis_s.debug.rom`);
	await otherRegistered;
	const windows = (await call('studio_list_sessions')).sessions;
	assert.equal(windows.length, 2);
	const otherSession = windows.find((window: { id: string }) => window.id !== sessions[0].id);
	const otherContext = await call('studio_open_context', { session: otherSession.id });
	const otherStatus = await call('studio_runtime_status', otherContext);
	assert.notEqual(otherStatus.target, target);
	assert.equal((await first.callTool({ name: 'studio_pause_runtime', arguments: { ...otherContext, target } }) as CallToolResult).isError, true);
	assert.equal(model.requests.length, 0);
	await page.close();
	assert.equal((await codex.request('mcpServer/tool/call', { threadId, server: 'bmsx', tool: 'studio_runtime_status', arguments: nativeContext })).isError, true,
		'closing a window cannot reroute an existing conversation to a different window');
	assert.equal((await call('studio_runtime_status', otherContext)).target, otherStatus.target);
	await nativeCall('studio_close_context', nativeContext);
	await call('studio_close_context', otherContext);
	await other.close();
	assert.deepEqual((await call('studio_list_sessions')).sessions, []);
	assert.deepEqual(assistantRequests, []);
	await assert.rejects(access(f.trace), { code: 'ENOENT' });
	await assert.rejects(access(join(f.root, 'state')), { code: 'ENOENT' });
	assert.deepEqual(errors, []);
});
