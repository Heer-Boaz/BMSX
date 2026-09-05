import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Playwright is a host test tool, not part of the player bundle. An explicit
// module path allows the same test to use a separately installed browser SDK.
const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
const [bios, cart, screenshot] = process.argv.slice(2);
if (!bios || !cart) throw new Error('Usage: browser.mjs SYSTEM_ROM CART_ROM [SCREENSHOT_PNG]');
const directory = await mkdtemp(join(tmpdir(), 'bmsx-webgpu-rewind-'));
let browser;
const files = new Map();
const server = createServer((request, response) => {
	const entry = files.get(request.url);
	if (!entry) { response.writeHead(404); response.end(); return; }
	response.setHeader('Content-Type', entry.type);
	response.end(entry.body);
});
try {
	await build({ entryPoints: [resolve(import.meta.dirname, 'browser_runner.ts')], bundle: true,
		platform: 'browser', format: 'esm', target: 'es2020', outfile: join(directory, 'test.js'),
		tsconfig: 'tsconfig.base.json', loader: { '.glsl': 'text', '.wgsl': 'text', '.png': 'dataurl' } });
	files.set('/', { type: 'text/html', body: '<!doctype html><canvas width="256" height="212"></canvas>' });
	files.set('/test.js', { type: 'text/javascript', body: await readFile(join(directory, 'test.js')) });
	files.set('/bios.rom', { type: 'application/octet-stream', body: await readFile(bios) });
	files.set('/cart.rom', { type: 'application/octet-stream', body: await readFile(cart) });
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	// Linux headless Vulkan setup follows Chrome's WebGPU testing guidance.
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-webgpu',
		'--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
		'--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	const page = await browser.newPage({ viewport: { width: 768, height: 576 } });
	page.on('pageerror', error => console.error(error));
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	const result = await page.evaluate(async () => {
		const test = await import('/test.js');
		return test.runBrowserRewindConformance(document.querySelector('canvas'));
	});
	if (screenshot) await page.screenshot({ path: screenshot });
	console.log(JSON.stringify(result));
	console.log('RUNTIME-WEBGPU-REWIND:PASS');
} finally {
	if (browser) await browser.close();
	server.close();
	await rm(directory, { recursive: true, force: true });
}
