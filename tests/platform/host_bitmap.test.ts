import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import type { createHostBitmapTest } from '../conformance/runtime_replay/host_bitmap';

declare global { var bitmapTest: Awaited<ReturnType<typeof createHostBitmapTest>>; }

test('actual software/WebGL2/WebGPU bitmap pixels, first upload, revision updates and resized bindings', { timeout: 60000 }, async t => {
	const bundle = await build({ entryPoints: ['tests/conformance/runtime_replay/host_bitmap.ts'], bundle: true,
		platform: 'browser', target: 'es2020', format: 'esm', write: false, tsconfig: 'tsconfig.base.json',
		loader: { '.glsl': 'text', '.wgsl': 'text' } });
	const bios = await readFile('dist/system/bmsx-bios.debug.rom');
	const server = createServer((request, response) => {
		const path = new URL(request.url!, 'http://local').pathname;
		if (path === '/test.js') response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text);
		else if (path === '/bios.rom') response.end(bios);
		else if (path === '/') response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><link rel="icon" href="data:,"><style>body{margin:0}</style><canvas width="16" height="8"></canvas>');
		else response.writeHead(404).end();
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-webgpu',
		'--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
		'--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	t.after(() => browser.close());
	for (const kind of ['software', 'webgl2', 'webgpu'] as const) {
		const page = await browser.newPage({ viewport: { width: 16, height: 8 } }), errors: Error[] = [];
		page.on('pageerror', error => errors.push(error));
		await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
		await page.evaluate(async kind => {
			const path = '/test.js', module = await import(path);
			globalThis.bitmapTest = await module.createHostBitmapTest(kind, document.querySelector('canvas'));
		}, kind);
		for (const phase of ['first', 'borrow-mutated', 'updated', 'resized'] as const) {
			if (phase === 'borrow-mutated') await page.evaluate(() => bitmapTest.mutateProducer());
			if (phase === 'updated') await page.evaluate(() => bitmapTest.publish());
			if (phase === 'resized') await page.evaluate(() => bitmapTest.resize());
			const uploads = await page.evaluate(() => bitmapTest.paint());
			const image = PNG.sync.read(await page.locator('canvas').screenshot());
			const expected = phase === 'resized' ? [[0, 255, 255, 255], [255, 0, 255, 255]]
				: phase === 'updated' ? [[0, 0, 255, 255], [255, 255, 0, 255]] : [[255, 0, 0, 255], [0, 255, 0, 255]];
			assert.deepEqual([image.width, image.height], [16, 8]);
			for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
				const offset = (y * 16 + x) * 4, half = phase === 'resized' ? (y < 4 ? 0 : 1) : (x < 8 ? 0 : 1);
				assert.deepEqual([...image.data.subarray(offset, offset + 4)], expected[half], `${kind} ${phase} pixel ${x},${y}`);
			}
			if (kind !== 'software') {
				assert.equal(uploads.updates, phase === 'updated' || phase === 'resized' ? 1 : 0);
				assert.equal(uploads.creates, phase === 'resized' ? 2 : 1);
			}
		}
		await page.evaluate(() => bitmapTest.dispose());
		assert.deepEqual(errors, []); await page.close();
	}
});
