import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import type { createHostBitmapTest } from '../conformance/runtime_replay/host_bitmap';
import type { HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';
import type { HostOverlayTransform } from '../../machine/ts/render/host_overlay/transform';

const colors: Record<string, number[]> = {
	'.': [32, 64, 96, 255], R: [255, 0, 0, 255], G: [0, 255, 0, 255], B: [0, 0, 255, 255], Y: [255, 255, 0, 255],
	C: [0, 255, 255, 255], M: [255, 0, 255, 255], W: [255, 255, 255, 255], K: [0, 0, 0, 255],
	w: [128, 64, 32, 255], m: [128, 0, 32, 255], b: [0, 0, 32, 255], g: [0, 64, 0, 255],
	a: [56, 56, 74, 255],
};
const command: Omit<HostBitmapRenderSubmission, 'bitmap'> = {
	originX: 2, originY: 1, axisXX: 8, axisXY: 0, axisYX: 0, axisYY: 4,
	u0: 0, v0: 0, u1: 1, v1: 1, color: 0xffffffff,
};
const affineCases = [
	{ name: 'rotation', command: { ...command, originX: 8, axisXX: 0, axisXY: 4, axisYX: -2, axisYY: 0 },
		rows: ['................', '......CR........', '......MG........', '......WB........', '......KY........', '................', '................', '................'] },
	{ name: 'shear', command: { ...command, axisYX: 2 },
		rows: ['................', '..RRGGBBYY......', '...RRGGBBYY.....', '...CCMMWWKK.....', '....CCMMWWKK....', '................', '................', '................'] },
	{ name: 'reflected half-pixel edges', command: { ...command, originX: 10.5, originY: 1.5, axisXX: -8 }, exactEdgeTies: true,
		rows: ['................', '..YYYBBGGR......', '..YYYBBGGR......', '..KKKWWMMC......', '..KKKWWMMC......', '................', '................', '................'] },
	{ name: 'reflected diagonal edges', command: { ...command, originX: 10.5, originY: 1.5, axisXX: -4, axisYX: -2 }, exactEdgeTies: true,
		rows: ['................', '......YYBG......', '......YBGR......', '.....KKWM.......', '.....KWMC.......', '................', '................', '................'] },
	{ name: 'fractional origin', command: { ...command, originX: 2.75, originY: 0.75 },
		rows: ['................', '...RRGGBBYY.....', '...RRGGBBYY.....', '...CCMMWWKK.....', '...CCMMWWKK.....', '................', '................', '................'] },
	{ name: 'crop flip tint clip', command: { ...command, originX: 0, originY: 0, axisXX: 16, axisYY: 8, u0: 0.75, v0: 1, u1: 0.25, v1: 0, color: 0xff804020 },
		clip: { left: 4, top: 2, right: 12, bottom: 6 },
		rows: ['................', '................', '....wwwwmmmm....', '....wwwwmmmm....', '....bbbbgggg....', '....bbbbgggg....', '................', '................'] },
	{ name: 'sheared crop flip tint clip', command: { ...command, axisYX: 2, u0: 0.75, v0: 1, u1: 0.25, v1: 0, color: 0xff804020 },
		clip: { left: 4, top: 2, right: 11, bottom: 5 },
		rows: ['................', '................', '....wwwmmmm.....', '....bbbgggg.....', '....bbbbggg.....', '................', '................', '................'] },
	{ name: 'nearest clamp', command: { ...command, u0: -0.5, v0: -0.5, u1: 1.5, v1: 1.5 },
		rows: ['................', '..RRRGBYYY......', '..RRRGBYYY......', '..CCCMWKKK......', '..CCCMWKKK......', '................', '................', '................'] },
	{ name: 'singular affine', command: { ...command, axisXX: 4, axisXY: 2, axisYX: 8, axisYY: 4 },
		rows: Array<string>(8).fill('................') },
	{ name: 'nested transform', command: { ...command, originX: 8, originY: 2, axisXX: 0, axisXY: 8, axisYX: -4, axisYY: 0 },
		scopes: [{ scale: 2, offsetX: 1, offsetY: 2 }, { scale: 0.25, offsetX: 1, offsetY: -1 }] satisfies HostOverlayTransform[],
		rows: ['................', '.....CR.........', '.....MG.........', '.....WB.........', '.....KY.........', '................', '................', '................'] },
	{ name: 'source-over alpha', command: { ...command, color: 0x80804020 }, alpha: true,
		rows: ['................', '..aaaaaaaa......', '..aaaaaaaa......', '..aaaaaaaa......', '..aaaaaaaa......', '................', '................', '................'] },
];

function onOuterBoundary(geometry: typeof command, x: number, y: number): boolean {
	const px = x + 0.5 - geometry.originX, py = y + 0.5 - geometry.originY;
	const area = geometry.axisXX * geometry.axisYY - geometry.axisXY * geometry.axisYX;
	const s = px * geometry.axisYY - py * geometry.axisYX, t = geometry.axisXX * py - geometry.axisXY * px;
	const low = Math.min(0, area), high = Math.max(0, area);
	return s >= low && s <= high && t >= low && t <= high && (s === 0 || s === area || t === 0 || t === area);
}

const joinedCases = [
	{ name: 'vertical', first: { ...command, originX: 2.5, originY: 1.5, axisXX: 4 },
		second: { ...command, originX: 6.5, originY: 1.5, axisXX: 4 }, samples: [[6, 2], [6, 3], [6, 4]] },
	{ name: 'horizontal', first: { ...command, originX: 2.5, originY: 1.5, axisYY: 2 },
		second: { ...command, originX: 2.5, originY: 3.5, axisYY: 2 }, samples: [[3, 3], [6, 3], [9, 3]] },
	{ name: 'diagonal', first: { ...command, originX: 2.5, originY: 1.5, axisXX: 4, axisYX: 2 },
		second: { ...command, originX: 6.5, originY: 1.5, axisXX: 4, axisYX: 2 }, samples: [[7, 3]] },
	{ name: 'reflected diagonal', first: { ...command, originX: 10.5, originY: 1.5, axisXX: -4, axisYX: -2 },
		second: { ...command, originX: 6.5, originY: 1.5, axisXX: -4, axisYX: -2 }, samples: [[5, 3]] },
];

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
		let affineUploads = 0;
		for (const item of affineCases) {
			await t.test(`${kind} ${item.name}`, async () => {
				const uploads = await page.evaluate(item => bitmapTest.paintAffine(item.command, item.clip, item.scopes, item.alpha), item);
				const image = PNG.sync.read(await page.locator('canvas').screenshot());
				for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
					// ES 3.0 section 3.6 does not prescribe which polygon owns an exact boundary.
					// Check stable interiors here; the joined-quad tests below prove single shared-edge ownership.
					if (kind === 'webgl2' && item.exactEdgeTies && onOuterBoundary(item.command, x, y)) continue;
					const offset = (y * 16 + x) * 4;
					assert.deepEqual([...image.data.subarray(offset, offset + 4)], colors[item.rows[y][x]], `${kind} ${item.name} pixel ${x},${y}`);
				}
				if (kind !== 'software' && !item.alpha) {
					if (affineUploads === 0) affineUploads = uploads.creates;
					assert.equal(uploads.creates, affineUploads, 'new affine geometry does not allocate or upload a new texture');
					assert.equal(uploads.updates, 1, 'UV, tint and geometry changes do not publish new pixels');
				}
			});
		}
		for (const item of joinedCases) await t.test(`${kind} ${item.name} shared-edge sample has exactly one owner`, async () => {
			await page.evaluate(item => bitmapTest.paintAffine({ ...item.first, color: 0x80804020 }, undefined, [], true,
				{ ...item.second, color: 0x80804020 }), item);
			const image = PNG.sync.read(await page.locator('canvas').screenshot());
			for (const [x, y] of item.samples) {
				const offset = (y * 16 + x) * 4;
				assert.deepEqual([...image.data.subarray(offset, offset + 4)], colors.a, `${kind} ${item.name} seam ${x},${y}: no gap or double alpha blend`);
			}
		});
		await page.evaluate(() => bitmapTest.dispose());
		assert.deepEqual(errors, []); await page.close();
	}
});
