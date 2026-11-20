import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createStudioServer } from '../helpers/studio_server.mjs';
import { createCodexContractFixture } from '../helpers/codex_app_server.mjs';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';
import { openBrowserTestPage } from '../helpers/browser_test_pages';

test('the real Codex CLI discovers and calls an explicitly selected browser Studio without starting chat', { timeout: 20_000 }, async t => {
	const f = await createStudioServer(t);
	const endpoint = `${f.address}/__bmsx__/mcp`;
	assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
	assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...f.headers, Origin: 'https://untrusted.example' } })).status, 403);
	// Close the browser and the native MCP client before retiring the HTTP server.
	await t.test('native discovery and context lifetime', async t => {
		const model = await createCodexModelFixture(t, []);
		const codex = await createCodexContractFixture(t, model.url, { mcp: { url: endpoint,
			headersHelper: `node ${JSON.stringify(resolve('scripts/dev/studio-mcp-headers.mjs'))} ${f.address} ${JSON.stringify(f.root)}` } });
		const threadId = await codex.startThread();
		const call = async (tool: string, args: Record<string, unknown> = {}) => {
			const result = await codex.request('mcpServer/tool/call', { threadId, server: 'bmsx', tool, arguments: args });
			assert.notEqual(result.isError, true, JSON.stringify(result));
			return result.structuredContent.result;
		};
		assert.deepEqual((await call('studio_list_sessions')).sessions, []);
		const page = await openBrowserTestPage(t);
		const errors: string[] = [], assistantRequests: string[] = [];
		page.on('pageerror', error => errors.push(String(error)));
		page.on('request', request => { if (request.url().includes('/__bmsx__/assistant/')) assistantRequests.push(request.url()); });
		const registered = page.waitForResponse(response => response.url().endsWith('/__bmsx__/studio/connect'));
		await page.goto(`${f.address}/studio.debug.html?rom=studio_test.debug.rom`);
		assert.equal((await registered).status(), 200);

		const { sessions } = await call('studio_list_sessions');
		assert.equal(sessions.length, 1);
		assert.equal(sessions[0].kind, 'browser');
		assert.equal(sessions[0].url, page.url());
		const context = await call('studio_open_context', { session: sessions[0].id });
		const status = await call('studio_runtime_status', context);
		assert.equal(status.hostFrameFailure, undefined);
		assert.equal(status.role, 'authoring');
		await call('studio_close_context', context);
		const retired = await codex.request('mcpServer/tool/call', {
			threadId, server: 'bmsx', tool: 'studio_runtime_status', arguments: context,
		});
		assert.equal(retired.isError, true, 'a closed context must not reopen or retarget itself');
		assert.equal(model.requests.length, 0);
		assert.deepEqual(assistantRequests, []);
		await assert.rejects(access(f.trace), { code: 'ENOENT' });
		await assert.rejects(access(join(f.root, 'state')), { code: 'ENOENT' });
		assert.deepEqual(errors, []);
	});
});
