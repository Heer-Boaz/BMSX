import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';
import { chromium } from 'playwright';

test('isolated player reads relative and cross-origin ROM URLs without CORS preflights', async t => {
	const bundle = await build({
		stdin: { contents: "export { loadBrowserMedia } from './hosts/browser/boot';", resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'bootMedia', write: false,
		plugins: [glsl()], loader: { '.png': 'dataurl', '.glsl': 'text', '.wgsl': 'text' },
	});
	const requests: string[] = [];
	const media = createServer((request, response) => {
		requests.push(`${request.method} ${request.url}`);
		// GitHub Pages allows simple CORS reads but does not answer OPTIONS preflights.
		response.setHeader('Access-Control-Allow-Origin', '*');
		if (request.method !== 'GET') { response.writeHead(405).end(); return; }
		const path = new URL(request.url!, 'http://media').pathname;
		const samples = new Map([
			['/release/system/bios.rom', [1, 2]],
			['/release/cart.rom', [3, 4]],
			['/release/slot1.rom', [5, 6]],
		]).get(path);
		if (samples === undefined) { response.writeHead(404).end(); return; }
		response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(Buffer.from(samples));
	});
	const player = createServer((request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		const path = new URL(request.url!, 'http://player').pathname;
		if (path === '/boot.js') {
			response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text);
		} else if (path === '/games/test/system/bios.rom' || path === '/games/test/cart.rom' || path === '/root-cart.rom') {
			response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(Buffer.from([7, 8]));
		} else {
			response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><link rel="icon" href="data:,"><script src="/boot.js"></script>');
		}
	});
	for (const server of [media, player]) {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		t.after(async () => {
			server.closeAllConnections();
			await new Promise<void>(resolve => server.close(() => resolve()));
		});
	}
	const mediaOrigin = `http://127.0.0.1:${(media.address() as { port: number }).port}`;
	const playerOrigin = `http://127.0.0.1:${(player.address() as { port: number }).port}`;
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	const url = new URL('/games/test/', playerOrigin);
	url.searchParams.set('rom', `${mediaOrigin}/release/cart.rom?version=1&variant=release`);
	url.searchParams.set('slot1', `${mediaOrigin}/release/slot1.rom`);
	await page.goto(url.href);
	assert.equal(await page.evaluate(() => crossOriginIsolated), true);
	const remote = await page.evaluate(async origin => {
		const media = await (globalThis as any).bootMedia.loadBrowserMedia(`${origin}/release/system/bios.rom`, 'unused.rom');
		return { system: Array.from(media.systemRom), slots: media.cartridgeSlots.map((slot: Uint8Array) => Array.from(slot)) };
	}, mediaOrigin);
	assert.deepEqual(remote, { system: [1, 2], slots: [[3, 4], [5, 6]] });
	assert.deepEqual(requests.sort(), [
		'GET /release/cart.rom?version=1&variant=release',
		'GET /release/slot1.rom',
		'GET /release/system/bios.rom',
	]);

	await page.goto(`${playerOrigin}/games/test/`);
	for (const cartridge of ['cart.rom', './cart.rom', '/root-cart.rom']) {
		const local = await page.evaluate(async cartridge => {
			const media = await (globalThis as any).bootMedia.loadBrowserMedia('system/bios.rom', cartridge);
			return { system: Array.from(media.systemRom), slot0: Array.from(media.cartridgeSlots[0]), slot1: media.cartridgeSlots[1] };
		}, cartridge);
		assert.deepEqual(local, { system: [7, 8], slot0: [7, 8], slot1: null });
	}
	const absoluteDefault = await page.evaluate(async origin => {
		const media = await (globalThis as any).bootMedia.loadBrowserMedia(`${origin}/release/system/bios.rom`, `${origin}/release/cart.rom`);
		return Array.from(media.cartridgeSlots[0]);
	}, mediaOrigin);
	assert.deepEqual(absoluteDefault, [3, 4]);
	await assert.rejects(page.evaluate(async origin => {
		await (globalThis as any).bootMedia.loadBrowserMedia(`${origin}/missing.rom`, `${origin}/release/cart.rom`);
	}, mediaOrigin), /Failed to fetch ROM/);
});
