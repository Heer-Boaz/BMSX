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

test('browser source admission commits stable identities across connections and respects explicit selections', async t => {
	const { page, address, requests, errors } = await standalone(t);
	await page.goto(address);
	const bundle = await build({ stdin: { contents: `export { resolveBrowserSourceContext } from './ide/browser/source_contexts';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'sourceContexts', write: false });
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const initial = await page.evaluate(async () => {
		const { resolveBrowserSourceContext: admit } = (globalThis as any).sourceContexts;
		const [first, second, system] = await Promise.all([admit('carts/alpha'), admit('carts/alpha'), admit('machine/bios')]);
		return { first, second, system };
	});
	assert.deepEqual(initial.first, initial.second);
	assert.notEqual(initial.first.id, initial.system.id);
	await page.reload();
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	assert.deepEqual(await page.evaluate(() => (globalThis as any).sourceContexts.resolveBrowserSourceContext('carts/alpha')), initial.first);
	const selected = await page.evaluate(async () => {
		const replacement = { id: crypto.randomUUID(), projectRoot: 'carts/alpha' };
		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open('bmsx-studio-source-contexts');
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const database = open.result, transaction = database.transaction(['contexts', 'sourceOpenSelections'], 'readwrite');
				transaction.objectStore('contexts').add(replacement);
				transaction.objectStore('sourceOpenSelections').put(replacement.id, replacement.projectRoot);
				transaction.oncomplete = () => { database.close(); resolve(); };
				transaction.onabort = () => { database.close(); reject(transaction.error); };
			};
		});
		return replacement;
	});
	assert.notEqual(selected.id, initial.first.id);
	assert.deepEqual(await page.evaluate(() => (globalThis as any).sourceContexts.resolveBrowserSourceContext('carts/alpha')), selected);
	assert.deepEqual(requests, []);
	assert.deepEqual(errors, []);
});

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

test('browser workspace: empty directories commit exclusively without records and survive reopening', async t => {
	const { page, address, requests, errors } = await standalone(t);
	await page.goto(address);
	const bundle = await build({ stdin: { contents: `export { IndexedDbWorkspaceRecordProvider } from './ide/browser/indexeddb_workspace_records';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'workspace', write: false });
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const result = await page.evaluate(async () => {
		const { IndexedDbWorkspaceRecordProvider: Provider } = (globalThis as any).workspace;
		const first = await Provider.open(), second = await Provider.open();
		await first.createDirectory('cart/nested/empty');
		const empty = await second.readDirectory('cart/nested/empty'), parent = await second.readDirectory('cart/nested');
		const raced = await Promise.allSettled([first.createDirectory('cart/raced'), second.createDirectory('cart/raced')]);
		await first.write('cart/file.lua', { contents: 'return 1', updatedAt: 1 }, false);
		const collisions = await Promise.allSettled([
			first.createDirectory('cart/nested/empty'), second.createDirectory('cart/file.lua'), first.createDirectory('cart/file.lua/child'),
		]);
		const namespaceRace = await Promise.allSettled([
			first.createDirectory('race/entry'), second.write('race/entry', { contents: 'return 2', updatedAt: 2 }, false),
		]);
		const records = await new Promise<string[]>((resolve, reject) => {
			const open = indexedDB.open('bmsx-studio-workspace');
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const database = open.result, transaction = database.transaction('records'), read = transaction.objectStore('records').getAllKeys();
				transaction.oncomplete = () => { database.close(); resolve(read.result as string[]); };
				transaction.onabort = () => { database.close(); reject(transaction.error); };
			};
		});
		first.close(); second.close();
		const reopened = await Provider.open(), retained = await reopened.readDirectory('cart/nested/empty'); reopened.close();
		return { empty, parent, retained, records, raced: raced.map(result => result.status),
			collisions: collisions.map(result => result.status), namespaceRace: namespaceRace.map(result => result.status) };
	});
	assert.deepEqual(result.empty, []); assert.deepEqual(result.retained, []);
	assert.deepEqual(result.parent, [{ name: 'empty', type: 'directory' }]);
	assert.deepEqual(result.raced.sort(), ['fulfilled', 'rejected']);
	assert.deepEqual(result.collisions, ['rejected', 'rejected', 'rejected']);
	assert.deepEqual(result.namespaceRace.sort(), ['fulfilled', 'rejected']);
	assert.deepEqual(result.records, result.namespaceRace[1] === 'fulfilled' ? ['cart/file.lua', 'race/entry'] : ['cart/file.lua'],
		'directory admission never writes dummy content records');
	assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});

test('standalone product: source creation, Save, reload and offline editing without server requests', { timeout: 120000 }, async t => {
	const { page, address, requests, errors } = await standalone(t);
	const evidence = '/tmp/bmsx-studio-standalone'; await mkdir(evidence, { recursive: true });
	const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	const press = async (keys: string) => { await page.keyboard.press(keys, { delay: 100 }); await frame(); };
	const command = async (title: string) => { await press('Control+Shift+p'); await page.keyboard.type(title, { delay: 25 }); await press('Enter'); };
	// BrowserTextInput exposes the focused control's bounded source context, not a second editor model.
	const waitForNativeText = (text: string) => page.waitForFunction(text => {
		const active = document.activeElement;
		return active instanceof HTMLTextAreaElement && active.value === text;
	}, text);
	const openFile = async (name: string) => {
		await press('Control+,'); await page.evaluate(text => navigator.clipboard.writeText(text), name); await press('Control+v');
		await waitForNativeText(name); await press('Enter');
	};
	const boot = async () => { await page.waitForFunction(() => document.body.classList.contains('game-started')); await frame(); };
	const screenshot = (name: string) => page.screenshot({ path: join(evidence, `${name}.png`) });
	await page.goto(`${address}/studio.debug.html?rom=hot_resume_test.debug.rom`); await boot();
	// Let the actual BIOS/cart intro run before the workbench's normal host pause.
	await page.waitForTimeout(15000); await press('ControlRight+ShiftRight');
	await screenshot('editor');
	// Physical BIOS commands and admission are covered by studio_terminal.ts,
	// not by the removed host-console transcript or its clipboard/focus model.
	await command('New Lua File'); await press('Enter');
	await page.keyboard.type('standalone_probe.lua', { delay: 25 }); await press('Enter');
	await waitForNativeText(''); await screenshot('created');
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
	const probePath = 'carts/hot_resume_test/standalone_probe.lua';
	await waitForSource(probePath, source); await screenshot('saved');
	// Browser-local recovery must not become server-file writes when the same origin hosts services later.
	assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('bmsx.workspace.records:'))), false);
	await page.reload(); await boot(); await press('ControlRight+ShiftRight');
	await press('Control+Home'); await waitForNativeText('local value = 6 * 7');
	await press('Control+a'); await press('Control+c');
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
	await screenshot('restored');
	await page.context().setOffline(true);
	await press('Control+End'); await page.keyboard.type('-- offline edit\n', { delay: 25 }); await press('Control+s');
	await waitForSource(probePath, source + '-- offline edit\n'); await screenshot('offline-save');
	await press('Control+Shift+p'); await page.keyboard.type('Codex', { delay: 25 });
	await screenshot('codex-disabled'); await press('Enter'); await press('Escape');
	// Exceeds the old workspace reconnect delay: absence must not create a retry timer.
	await page.waitForTimeout(11000);
	assert.deepEqual(requests, []); assert.deepEqual(errors, []);
	// Actual browser quota denial, not a replaced provider or a mocked Save result.
	await openFile('standalone_probe.lua'); await press('Control+Home'); await waitForNativeText('local value = 6 * 7');
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
		{ name: 'standalone_source.yaml', format: 'yaml' },
		{ name: 'standalone_events.aem.yaml', format: 'aem' },
	];
	const unopened = await page.evaluate(paths => new Promise(resolve => {
		const request = indexedDB.open('bmsx-studio-workspace');
		request.onsuccess = () => {
			const database = request.result, transaction = database.transaction('records'), records = transaction.objectStore('records');
			const reads = paths.map(path => records.get(path));
			transaction.oncomplete = () => { resolve(reads.map(read => read.result)); database.close(); };
		};
	}), documents.map(({ name }) => `carts/hot_resume_test/res/data/${name}`));
	assert.deepEqual(unopened, [undefined, undefined], 'packaged authored bases have not been preseeded into browser source files');
	const edited = new Map<string, string>();
	for (const { name, format } of documents) {
		const path = `carts/hot_resume_test/res/data/${name}`;
		const authored = await readFile(path, 'utf8');
		await openFile(name);
		if (format === 'aem') {
			await screenshot('aem-resource-editor');
			await command('Editor: Open Source');
		}
		await press('Control+Home'); await waitForNativeText(authored.slice(0, authored.indexOf('\n')));
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
		await press('ArrowRight'); await screenshot(`${format}-offline-save`);
	}
	await page.context().setOffline(false); await page.reload(); await boot(); await press('ControlRight+ShiftRight');
	for (const { name, format } of documents) {
		await openFile(name);
		if (format === 'aem') await command('Editor: Open Source');
		await press('Control+Home'); await waitForNativeText('# Browser-owned edit');
		await press('Control+a'); await press('Control+c');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), edited.get(name));
		await press('Escape'); await press('Control+Home'); await screenshot(`${format}-restored`);
	}
	assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
