import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import { createStudioServer } from '../helpers/studio_server.mjs';

for (const backend of ['webgl2', 'webgpu'] as const) test(`${backend}: native UI capture observes the real Studio canvas without bypassing user review`, { timeout: 60000 }, async t => {
	const client = new Client({ name: 'studio-ui-capture', version: '1.0.0' });
	let transport: StreamableHTTPClientTransport, browser: Browser;
	// Retire clients and the browser before the server. Independent cleanup hooks
	// still close the browser when a transport failure is the test's outcome.
	t.after(() => transport?.terminateSession());
	t.after(() => client.close());
	t.after(() => browser?.close());
	const f = await createStudioServer(t);
	transport = new StreamableHTTPClientTransport(new URL(`${f.address}/__bmsx__/mcp`), { requestInit: { headers: f.headers } });
	browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', ...(backend === 'webgpu'
		? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']
		: ['--disable-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
	await client.connect(transport);
	const call = async (name: string, args = {}) => {
		const result = await client.callTool({ name, arguments: args }) as CallToolResult;
		assert.notEqual(result.isError, true, JSON.stringify(result.content.filter(item => item.type !== 'image')));
		return result.structuredContent!.result as any;
	};
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(String(error)));
	const registered = page.waitForResponse(response => response.url().endsWith('/__bmsx__/studio/connect'));
	await page.goto(`${f.address}/studio.debug.html?rom=studio_test.debug.rom`);
	assert.equal((await registered).status(), 200);
	assert.equal(await page.evaluate(backend => document.querySelector('canvas')!.getContext(backend) !== null, backend), true,
		'the actual canvas backend, not just launch options, must match the case');
	const { sessions } = await call('studio_list_sessions');
	assert.equal(sessions.length, 1);
	const context = await call('studio_open_context', { session: sessions[0].id });
	const status = await call('studio_runtime_status', context);
	assert.equal(status.hostFrameFailure, undefined);
	const sources = await call('studio_list_sources', context);
	const resource = sources.find((source: { path: string; readOnly: boolean }) => source.path === 'cart.lua' && !source.readOnly);
	assert.ok(resource);
	const source = await call('studio_read_source', { ...context, resource: resource.resource });
	const proposal = await call('studio_propose_edits', { ...context, title: 'UI capture review', files: [{ receipt: source.receipt,
		edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: '-- pending UI review\n' }] }] });
	assert.equal((await call('studio_read_review', { ...context, review: proposal.review })).state, 'pending');
	const result = await client.callTool({ name: 'studio_capture_ui', arguments: context }) as CallToolResult;
	assert.notEqual(result.isError, true, JSON.stringify(result.content.filter(item => item.type !== 'image')));
	const image = result.content.find(item => item.type === 'image')!;
	assert.equal(image.type, 'image');
	const receipt = result.structuredContent!.result as { capture: string; width: number; height: number; inputAllowed: boolean };
	const png = Buffer.from(image.data, 'base64'), decoded = PNG.sync.read(png);
	assert.deepEqual([receipt.width, receipt.height], [decoded.width, decoded.height], 'receipt coordinates address the encoded canvas pixels');
	assert.equal(receipt.inputAllowed, false);
	const firstPixel = decoded.data.readUInt32LE(0);
	let hasContent = false;
	for (let offset = 4; offset < decoded.data.length; offset += 4) if (decoded.data.readUInt32LE(offset) !== firstPixel) { hasContent = true; break; }
	assert.equal(hasContent, true, 'capture must not read an already-discarded blank drawing buffer');
	const evidence = '/tmp/bmsx-studio-ui'; await mkdir(evidence, { recursive: true });
	await writeFile(join(evidence, `${backend}.png`), png);
	const input = await client.callTool({ name: 'studio_ui_input', arguments: { ...context, capture: receipt.capture,
		steps: [{ events: [{ type: 'key', code: 'Enter', down: true }], frames: 1 }] } }) as CallToolResult;
	assert.equal(input.isError, true);
	assert.equal((await call('studio_read_review', { ...context, review: proposal.review })).state, 'pending');
	const fresh = await call('studio_open_context', { session: sessions[0].id });
	const freshSources = await call('studio_list_sources', fresh);
	const freshResource = freshSources.find((candidate: { path: string; contextId: string }) =>
		candidate.path === resource.path && candidate.contextId === resource.contextId);
	assert.equal((await call('studio_read_source', { ...fresh, resource: freshResource.resource })).source, source.source);
	assert.equal(await readFile(join(f.root, 'carts/studio_test/cart.lua'), 'utf8'), source.source);
	await call('studio_close_context', fresh);
	await call('studio_close_context', context);
	assert.deepEqual(errors, []);
});
