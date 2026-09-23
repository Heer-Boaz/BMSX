import type { TestContext } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Browser } from 'playwright';
import { CodexHttpApi } from '../../hosts/node/codex/http_api';
import type { CodexSessionOptions } from '../../hosts/node/codex/session';
import { STUDIO_SOURCE_TOOLS } from '../../ide/workbench/services/assistant/source_tool_protocol';
import { STUDIO_TEST_TOOLS } from '../../ide/workbench/services/assistant/test_tool_protocol';
import { WorkspaceHttpSession, HttpError } from '../../scripts/dev/http_security.mjs';
import { handleWorkspaceRequest } from '../../scripts/dev/workspace_api.mjs';

/** Isolated authored workspace, real HTTP owners and browser; no product test endpoints or provider knobs. */
export async function createAssistantStudioFixture(t: TestContext, evidenceName: string, options: Pick<CodexSessionOptions, 'executable' | 'provider'>) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-studio-assistant-'));
	let browser: Browser | undefined;
	let closeServer: (() => Promise<void>) | undefined;
	t.after(async () => { await browser?.close(); await closeServer?.(); await rm(root, { recursive: true }); });
	await build({ entryPoints: ['tests/conformance/runtime_replay/studio_assistant.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2020',
		outfile: join(root, 'test.js'), tsconfig: 'tsconfig.base.json', loader: { '.glsl': 'text', '.wgsl': 'text', '.png': 'dataurl' } });
	await writeFile(join(root, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#000}canvas{image-rendering:pixelated}</style><canvas width="256" height="212"></canvas>');
	await copyFile('dist/bmsx-bios.debug.rom', join(root, 'bios.rom')); await copyFile('dist/nemesis_s.debug.rom', join(root, 'cart.rom'));
	await copyFile('dist/graph-layout.worker.js', join(root, 'graph-layout.worker.js'));
	for (const path of ['carts/nemesis_s', 'cartlib', 'machine/bios', 'testlib', 'tests/carts/nemesis_s']) await cp(path, join(root, path), { recursive: true,
		filter: async path => (await stat(path)).isDirectory() || /\.(lua|yaml|yml)$/.test(path) });
	const profileDirectory = join(root, 'profile');
	const api = new CodexHttpApi({ ...options, profileDirectory, tools: [...STUDIO_SOURCE_TOOLS, ...STUDIO_TEST_TOOLS] });
	const authority = new WorkspaceHttpSession('127.0.0.1');
	const observations = { connects: 0, commands: [] as string[], errors: [] as Error[] };
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url!, 'http://local');
			if (url.pathname === '/__bmsx__/session') authority.bootstrap(request, response);
			else if (url.pathname.startsWith('/__bmsx__/')) {
				authority.authorize(request);
				if (url.pathname === '/__bmsx__/lua') await handleWorkspaceRequest(root, request, response, url);
				else { if (url.pathname.endsWith('/connect')) observations.connects++; await api.handle(request, response, url.pathname); }
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
	browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--disable-popup-blocking'], args: ['--no-sandbox', '--enable-unsafe-webgpu',
		'--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
		'--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	const page = await browser.newPage({ viewport: { width: 768, height: 576 } });
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	page.on('pageerror', error => observations.errors.push(error));
	page.on('request', request => { if (request.url().endsWith('/command')) observations.commands.push(request.postDataJSON().type); });
	page.on('console', message => console.log(`[${evidenceName}:${message.type()}] ${message.text()}`));
	const evidence = '/tmp/bmsx-studio-chat'; await mkdir(evidence, { recursive: true });
	await page.exposeFunction('capture', async (name: string) => { await page.screenshot({ path: join(evidence, `${evidenceName}-${name}.png`) }); });
	await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
	return { page, root, profileDirectory, evidence, observations };
}
