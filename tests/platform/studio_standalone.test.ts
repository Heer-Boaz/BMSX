import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/** Only packaged assets, deliberately no BMSX APIs or HTML rewriting. */
async function standalone(t: TestContext) {
	const requests: string[] = [], errors: string[] = [];
	const server = createServer(async (request, response) => {
		const path = new URL(request.url!, 'http://local').pathname;
		if (path.startsWith('/__bmsx__/')) requests.push(path);
		try {
			const content = path === '/' ? '<!doctype html><link rel="icon" href="data:,">' : await readFile(join('dist', path));
			response.writeHead(200, { 'Content-Type': path === '/' || path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
				'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(content);
		} catch { response.writeHead(404).end(); }
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
		'--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
	t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'] });
	page.on('request', request => { if (request.url().includes('/__bmsx__/')) requests.push(request.url()); });
	page.on('pageerror', error => errors.push(String(error)));
	page.on('console', message => { if (message.type() === 'error' || message.text().includes('[WorkspaceStorage]')) errors.push(message.text()); });
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	return { page, address, requests, errors };
}

test('browser workspace: committed CRUD, exclusive cross-connection create and directory discovery', async t => {
	const { page, address, requests, errors } = await standalone(t);
	await page.goto(address);
	const bundle = await build({ stdin: { contents: `export { IndexedDbWorkspaceRecordProvider } from './ide/browser/indexeddb_workspace_records';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'workspace', write: false });
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const result = await page.evaluate(async () => {
		const { IndexedDbWorkspaceRecordProvider: Provider } = (globalThis as any).workspace;
		const source = { contents: 'return 42', updatedAt: 1234 };
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('bmsx-studio-workspace', 1);
			request.onupgradeneeded = () => request.result.createObjectStore('records').add(source, 'old/cart.lua');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => { request.result.close(); resolve(); };
		});
		const first = await Provider.open(), second = await Provider.open();
		const migrated = await first.read('old/cart.lua');
		const raced = await Promise.allSettled([first.write('cart/new.lua', source, false), second.write('cart/new.lua', source, false)]);
		await first.write('cart/nested/a.lua', source, false); await first.write('cart/nested/b.lua', source, false);
		await first.write('cart2/unrelated.lua', source, false);
		const directory = await second.readDirectory('cart');
		const nested = await second.readDirectory('cart/nested');
		const empty = await second.read('missing.lua');
		const invalid = await Promise.allSettled([
			first.write('cart/nested', source, true), second.write('cart/new.lua/child.lua', source, false),
			first.read('cart/nested'), second.readDirectory('cart/new.lua'), first.delete('cart/nested'),
		]);
		const namespaceRace = await Promise.allSettled([
			first.write('race/file', source, false), second.write('race/file/child.lua', source, false),
		]);
		await first.write('cart/new.lua', { ...source, contents: 'return 43' }, true);
		first.close(); second.close();
		const reopened = await Provider.open(), persisted = await reopened.read('cart/new.lua');
		await reopened.delete('cart/new.lua'); const deleted = await reopened.read('cart/new.lua');
		await reopened.delete('cart/nested/a.lua'); await reopened.delete('cart/nested/b.lua');
		const emptyDirectory = await reopened.readDirectory('cart/nested');
		reopened.close();
		return { raced: raced.map(result => result.status), directory, nested, empty, persisted, deleted, migrated, emptyDirectory,
			invalid: invalid.map(result => result.status), namespaceRace: namespaceRace.map(result => result.status) };
	});
	assert.deepEqual(result.raced.sort(), ['fulfilled', 'rejected']);
	assert.deepEqual(result.directory, [{ name: 'nested', type: 'directory' }, { name: 'new.lua', type: 'file' }]);
	assert.deepEqual(result.nested, [{ name: 'a.lua', type: 'file' }, { name: 'b.lua', type: 'file' }]);
	assert.deepEqual(result.persisted, { contents: 'return 43', updatedAt: 1234 });
	assert.equal(result.empty, null); assert.equal(result.deleted, null);
	assert.deepEqual(result.migrated, { contents: 'return 42', updatedAt: 1234 });
	assert.deepEqual(result.invalid, Array(5).fill('rejected'));
	assert.deepEqual(result.namespaceRace.sort(), ['fulfilled', 'rejected']);
	assert.deepEqual(result.emptyDirectory, []);
	assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});

test('standalone product: Terminal, source creation, Save, reload and offline editing without server requests', { timeout: 120000 }, async t => {
	const { page, address, requests, errors } = await standalone(t);
	const evidence = '/tmp/bmsx-studio-standalone'; await mkdir(evidence, { recursive: true });
	const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	const press = async (keys: string) => { await page.keyboard.press(keys, { delay: 100 }); await frame(); };
	const command = async (title: string) => { await press('Control+Shift+p'); await page.keyboard.type(title, { delay: 25 }); await press('Enter'); };
	const boot = async () => { await page.waitForFunction(() => document.body.classList.contains('game-started')); await frame(); };
	const screenshot = (name: string) => page.screenshot({ path: join(evidence, `${name}.png`) });
	await page.goto(`${address}/studio.debug.html?rom=nemesis_s.debug.rom`); await boot();
	// Let the actual BIOS/cart intro run before the workbench's normal host pause.
	await page.waitForTimeout(15000); await press('ControlRight+ShiftRight');
	await screenshot('editor');
	await command('Lua Terminal');
	await page.evaluate(() => navigator.clipboard.writeText('return 6 * 7')); await press('Control+v'); await press('Enter');
	await page.waitForTimeout(1000);
	await press('Shift+Tab'); // Composer -> transcript, through the real focus ring.
	for (let index = 0; index < 10; index++) await press('ArrowDown');
	await press('Control+c');
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '42');
	await screenshot('terminal');
	await command('New Lua File'); await press('Enter');
	await page.keyboard.type('standalone_probe.lua', { delay: 25 }); await press('Enter');
	await page.waitForTimeout(300); await screenshot('created');
	const source = 'local value = 6 * 7\nreturn value\n';
	await page.evaluate(text => navigator.clipboard.writeText(text), source);
	await press('Control+a'); await press('Control+v'); await press('Control+s');
	const waitForSource = (path: string, contents: string) => page.waitForFunction(({ path, contents }) => new Promise(resolve => {
		const request = indexedDB.open('bmsx-studio-workspace');
		request.onsuccess = () => {
			const database = request.result, transaction = database.transaction('records');
			const record = transaction.objectStore('records').get(path);
			transaction.oncomplete = () => { resolve(record.result?.contents === contents); database.close(); };
		};
	}), { path, contents });
	const probePath = 'carts/nemesis_s/standalone_probe.lua';
	await waitForSource(probePath, source); await screenshot('saved');
	// Browser-local recovery must not become server-file writes when the same origin hosts services later.
	assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('bmsx.workspace.records:'))), false);
	await page.reload(); await boot(); await press('ControlRight+ShiftRight');
	await press('Control+a'); await press('Control+c');
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
	await screenshot('restored');
	await page.context().setOffline(true);
	await press('Control+End'); await page.keyboard.type('-- offline edit\n', { delay: 25 }); await press('Control+s');
	await waitForSource(probePath, source + '-- offline edit\n'); await screenshot('offline-save');
	await page.mouse.click(288, 36, { delay: 100 }); await frame(); await screenshot('view-menu'); await press('Escape');
	await press('Control+Shift+p'); await page.keyboard.type('Codex', { delay: 25 });
	await screenshot('codex-disabled'); await press('Enter'); await press('Escape');
	// Exceeds the old workspace reconnect delay: absence must not create a retry timer.
	await page.waitForTimeout(11000);
	assert.deepEqual(requests, []); assert.deepEqual(errors, []);
	// Actual browser quota denial, not a replaced provider or a mocked Save result.
	await page.mouse.click(720, 260, { delay: 100 }); await frame();
	const storageControl = await page.context().newCDPSession(page);
	await storageControl.send('Storage.overrideQuotaForOrigin', { origin: address, quotaSize: 1 });
	await press('Control+End'); await page.keyboard.type('-- retain after quota failure\n', { delay: 25 }); await press('Control+s');
	await page.waitForTimeout(700); await screenshot('quota-failed-save');
	await waitForSource(probePath, source + '-- offline edit\n');
	await storageControl.send('Storage.overrideQuotaForOrigin', { origin: address });
	await press('Control+s');
	await waitForSource(probePath, source + '-- offline edit\n-- retain after quota failure\n'); await screenshot('quota-retry');
	// Both documents are unopened and have no browser file yet. Their base must
	// come from the ROM, not a preseeded fixture, reconstructed YAML or HTTP read.
	const documents = [
		{ name: 'nemesis_s_stage.yaml', format: 'yaml' },
		{ name: 'events.aem.yaml', format: 'aem' },
	];
	const edited = new Map<string, string>();
	for (const { name, format } of documents) {
		const path = `carts/nemesis_s/res/data/${name}`;
		const authored = await readFile(path, 'utf8');
		await press('Control+,'); await page.evaluate(text => navigator.clipboard.writeText(text), name); await press('Control+v'); await press('Enter');
		await press('Control+a'); await press('Control+c');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), authored);
		await press('Escape'); await press('Control+Home'); await screenshot(`${format}-packaged-source`);
		const comment = '# Browser-owned edit\n';
		await page.evaluate(text => navigator.clipboard.writeText(text), comment); await press('Control+v');
		await press('Control+z'); await press('Control+a'); await press('Control+c');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), authored);
		await press('Control+Shift+z'); await press('Control+s');
		edited.set(name, comment + authored);
		await waitForSource(path, edited.get(name)!);
		await page.waitForTimeout(1000); await press('ArrowRight'); await screenshot(`${format}-offline-save`);
	}
	await page.context().setOffline(false); await page.reload(); await boot(); await press('ControlRight+ShiftRight');
	for (const { name, format } of documents) {
		await press('Control+,'); await page.evaluate(text => navigator.clipboard.writeText(text), name); await press('Control+v'); await press('Enter');
		await press('Control+a'); await press('Control+c');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), edited.get(name));
		await press('Escape'); await press('Control+Home'); await screenshot(`${format}-restored`);
	}
	assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
