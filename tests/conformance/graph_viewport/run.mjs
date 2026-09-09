import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'bmsx-graph-viewport-'));
const artifacts = resolve(process.argv[2] || 'tests/conformance/graph_viewport/screenshots');
await mkdir(artifacts, { recursive: true });
const errors = [];
let browser;
let server;
try {
	await build({ entryPoints: [resolve(import.meta.dirname, 'browser.ts')], bundle: true, platform: 'browser', format: 'esm',
		target: 'es2020', tsconfig: 'tsconfig.base.json', outfile: join(directory, 'test.js'), loader: { '.glsl': 'text', '.wgsl': 'text' } });
	const script = await readFile(join(directory, 'test.js'));
	server = createServer((request, response) => {
		if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript'); response.end(script);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<!doctype html><link rel="icon" href="data:,"><style>body{margin:0}canvas{image-rendering:pixelated}</style><canvas></canvas>');
		}
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
		'--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	for (const backend of ['software', 'webgl2', 'webgpu']) {
		const page = await browser.newPage({ viewport: { width: 384, height: 288 } });
		page.on('pageerror', error => errors.push(error));
		page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		const info = await page.evaluate(async kind => {
			const { createFixture } = await import('/test.js');
			window.fixture = await createFixture(document.querySelector('canvas'), kind);
			return { ...window.fixture.exercise(), primitives: window.fixture.primitives, clip: window.fixture.clip };
		}, backend);
		const target = page.locator('canvas');
		for (let index = 0; index < info.primitives.length; index += 1) {
			await page.evaluate(index => window.fixture.renderPrimitive(index, false), index);
			const reference = PNG.sync.read(await target.screenshot());
			await page.evaluate(index => window.fixture.renderPrimitive(index, true), index);
			const clipped = PNG.sync.read(await target.screenshot());
			let lit = 0;
			for (let y = 0; y < reference.height; y += 1) {
				for (let x = 0; x < reference.width; x += 1) {
					const inside = x >= info.clip.left && x < info.clip.right && y >= info.clip.top && y < info.clip.bottom;
					for (let channel = 0; channel < 3; channel += 1) {
						const offset = (y * reference.width + x) * 4 + channel;
						assert.equal(clipped.data[offset], inside ? reference.data[offset] : 0,
							`${backend} ${info.primitives[index]} clipping at ${x},${y}:${channel}`);
						if (clipped.data[offset] !== 0) lit += 1;
					}
				}
			}
			assert.ok(lit > 0, `${backend} ${info.primitives[index]} must produce visible clipped pixels`);
		}
		await page.evaluate(() => window.fixture.draw());
		await target.screenshot({ path: join(artifacts, `graph-${backend}.png`) });
		for (const [width, height] of [[256, 192], [384, 288]]) {
			await page.evaluate(([width, height]) => window.fixture.resize(width, height), [width, height]);
			const resized = PNG.sync.read(await target.screenshot());
			for (const [x, y, expected] of [[1 / 8, 1 / 2, 0], [1 / 2, 1 / 8, 0],
				[1 / 2, 1 / 2, 255], [7 / 8, 1 / 2, 0], [1 / 2, 7 / 8, 0]]) {
				const offset = (Math.trunc(y * resized.height) * resized.width + Math.trunc(x * resized.width)) * 4;
				for (let channel = 0; channel < 3; channel += 1) assert.equal(resized.data[offset + channel], expected, `${backend} resized clip at ${x},${y}`);
			}
			await page.evaluate(() => window.fixture.healthy());
		}
		await page.close();
		console.log(`GRAPH-VIEWPORT:${backend}:PASS (${info.primitives.length} pixel-crop oracles; target resize; physical input/pane lifecycle)`);
	}
	assert.deepEqual(errors, [], 'uncaught browser errors');
} finally {
	if (browser) await browser.close();
	if (server) await new Promise(resolve => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
