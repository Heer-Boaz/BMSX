import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { CodexHttpApi } from '../../hosts/node/codex/http_api';
import { STUDIO_SOURCE_TOOLS } from '../../ide/workbench/services/assistant/source_tool_protocol';
import { WorkspaceHttpSession, HttpError } from '../../scripts/dev/http_security.mjs';
import { handleWorkspaceRequest } from '../../scripts/dev/workspace_api.mjs';
import { createCodexModelFixture, CODEX_FIXTURE_DONE, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';

test('visible Studio conversation through actual browser, HTTP lease, Codex process, source tools and shared review', { timeout: 180000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-studio-assistant-'));
	let closeBrowser: (() => Promise<void>) | undefined;
	let closeServer: (() => Promise<void>) | undefined;
	t.after(async () => { await closeBrowser?.(); await closeServer?.(); await rm(root, { recursive: true }); });
	const call = (name: string, args: unknown) => ({ type: 'function_call', call_id: name, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string; role?: string }[] }) => body.input
		.slice(body.input.findLastIndex(item => item.role === 'user') + 1).filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
	let modelStarted!: () => void;
	const waiting = new Promise<void>(resolve => { modelStarted = resolve; });
	const reviewSteps = [
		[call('studio_list_sources', {})],
		body => {
			const catalog = outputs(body)[0];
			return [catalog.find(resource => resource.domain === 0 && resource.path === 'cart.lua'), catalog.find(resource => resource.domain === 0 && resource.path.endsWith('nemesis_s_stage.yaml'))]
				.map((resource, index) => ({ ...call('studio_read_source', { resource: resource.resource }), call_id: `read:${index}` }));
		},
		body => [call('studio_propose_edits', { title: 'Reviewed Lua and YAML comments', files: outputs(body).slice(1).map((read, index) => ({ receipt: read.receipt,
			edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: index === 0 ? '-- Codex reviewed\n' : '# Codex reviewed\n' }] })) })],
		CODEX_FIXTURE_DONE,
	];
	const model = await createCodexModelFixture(t, [...reviewSteps, () => { modelStarted(); return CODEX_FIXTURE_WAIT; }, ...reviewSteps]);
	await build({ entryPoints: ['tests/conformance/runtime_replay/studio_assistant.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2020',
		outfile: join(root, 'test.js'), tsconfig: 'tsconfig.base.json', loader: { '.glsl': 'text', '.wgsl': 'text', '.png': 'dataurl' } });
	await writeFile(join(root, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#000}canvas{image-rendering:pixelated}</style><canvas width="256" height="212"></canvas>');
	await copyFile('dist/bmsx-bios.debug.rom', join(root, 'bios.rom')); await copyFile('dist/nemesis_s.debug.rom', join(root, 'cart.rom'));
	await copyFile('dist/graph-layout.worker.js', join(root, 'graph-layout.worker.js'));
	for (const path of ['carts/nemesis_s', 'cartlib', 'machine/bios']) await cp(path, join(root, path), { recursive: true,
		filter: async path => (await stat(path)).isDirectory() || /\.(lua|yaml|yml)$/.test(path) });
	const api = new CodexHttpApi({ profileDirectory: join(root, 'profile'), tools: STUDIO_SOURCE_TOOLS,
		provider: { name: 'Offline Studio UI fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const authority = new WorkspaceHttpSession('127.0.0.1');
	let connects = 0;
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url!, 'http://local');
			if (url.pathname === '/__bmsx__/session') authority.bootstrap(request, response);
			else if (url.pathname.startsWith('/__bmsx__/')) {
				authority.authorize(request);
				if (url.pathname === '/__bmsx__/lua') {
					await handleWorkspaceRequest(root, request, response, url);
				} else { if (url.pathname.endsWith('/connect')) connects++; await api.handle(request, response, url.pathname); }
			} else {
				const path = url.pathname === '/' ? '/index.html' : url.pathname;
				response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream' })
					.end(await readFile(join(root, path)));
			}
		} catch (error) {
			if (response.headersSent) response.destroy(error as Error);
			else response.writeHead(error instanceof HttpError ? error.status : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500).end(String(error));
		}
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	closeServer = async () => { await api.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
	const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
	closeBrowser = () => browser.close();
	const page = await browser.newPage({ viewport: { width: 768, height: 576 } });
	const errors: Error[] = []; page.on('pageerror', error => errors.push(error));
	page.on('console', message => console.log(`[browser:${message.type()}] ${message.text()}`));
	const evidence = '/tmp/bmsx-studio-chat'; await mkdir(evidence, { recursive: true });
	await page.exposeFunction('capture', async (name: string) => { await page.screenshot({ path: join(evidence, `pane-${name}.png`) }); });
	await page.exposeFunction('waitForModel', () => waiting);
	await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
	const result = await page.evaluate(async () => {
		const entry = '/test.js';
		const module = await import(entry);
		return module.runAssistant(document.querySelector('canvas'), globalThis.capture, globalThis.waitForModel);
	});
	assert.equal(result.assistant, 'pass'); assert.equal(result.sourceFiles, 2);
	assert.equal(connects, 1); assert.equal(model.requests.length, 9); assert.deepEqual(errors, []);
	const reads = outputs(model.requests[2]).slice(1);
	assert.equal(reads[0].source, '-- UNSAVED ASSISTANT FIXTURE\n' + await readFile('carts/nemesis_s/cart.lua', 'utf8'));
	assert.equal(reads[1].source, await readFile('carts/nemesis_s/res/data/nemesis_s_stage.yaml', 'utf8'));
	assert.ok(JSON.stringify(outputs(model.requests[2])[0]).length > 16000, 'real catalog exceeds the old lossy truncation budget');
	for (const path of ['carts/nemesis_s/cart.lua', 'carts/nemesis_s/res/data/nemesis_s_stage.yaml']) {
		assert.equal(await readFile(join(root, path), 'utf8'), await readFile(path, 'utf8'), 'review never writes authored source files');
	}
	await writeFile(join(evidence, 'browser-result.json'), JSON.stringify(result));
});
