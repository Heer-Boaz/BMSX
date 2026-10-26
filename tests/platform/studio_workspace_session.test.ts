import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('browser workspace sessions retain reload recovery but isolate cloned and published documents for their lifetimes', { timeout: 30000 }, async t => {
	const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
		import { openBrowserWorkspaceSession } from './ide/browser/workspace_session';
		import { openPublishedBuild } from './ide/browser/published_media';
		globalThis.initialStorage = Object.fromEntries(Object.entries(sessionStorage));
		globalThis.ready = openBrowserWorkspaceSession().then(session => {
			globalThis.workspaceSession = session;
			return session.identity;
		});
		globalThis.openPublished = openPublishedBuild;
	` }, bundle: true, platform: 'browser', format: 'iife', write: false });
	const server = createServer((req, res) => {
		if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
		else res.end('<!doctype html><script src="/probe.js"></script>');
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const browser = await chromium.launch({ args: ['--no-sandbox'] });
	t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const requestId = '00000000-0000-4000-8000-000000000001';
	const url = `${origin}/studio.debug.html?build=${requestId}`;
	const context = await browser.newContext(), parent = await context.newPage();
	await parent.goto(url);
	const parentIdentity: string = await parent.evaluate(() => (globalThis as any).ready);
	const parentStorage = await parent.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
	const firstLeases = await parent.evaluate(async () => (await navigator.locks.query()).held!);
	assert.equal(firstLeases.length, 1);
	assert.equal(firstLeases[0].mode, 'exclusive');

	await parent.reload();
	assert.equal(await parent.evaluate(() => (globalThis as any).ready), parentIdentity);
	const reloadedLeases = await parent.evaluate(async () => (await navigator.locks.query()).held!);
	assert.equal(reloadedLeases.length, 1, 'reload releases the destroyed document lease before reacquiring the same recovery identity');
	assert.equal(reloadedLeases[0].name, firstLeases[0].name);
	assert.notEqual(reloadedLeases[0].clientId, firstLeases[0].clientId);

	const cloning = context.waitForEvent('page');
	await parent.evaluate(() => { window.open(location.href, '_blank'); });
	const clone = await cloning;
	await clone.waitForLoadState();
	const cloneIdentity: string = await clone.evaluate(() => (globalThis as any).ready);
	assert.deepEqual(await clone.evaluate(() => (globalThis as any).initialStorage), parentStorage, 'the browser really cloned the opener sessionStorage');
	assert.notEqual(cloneIdentity, parentIdentity, 'a live document exclusively owns its recovery identity');
	assert.equal(await parent.evaluate(() => (globalThis as any).workspaceSession.identity), parentIdentity);
	assert.deepEqual(await parent.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))), parentStorage);

	// Open the identical build URL: frontend recovery isolation is independent of project or request identity.
	const publishing = context.waitForEvent('page');
	const opened = await parent.evaluate(id => (globalThis as any).openPublished(id), requestId);
	assert.deepEqual(opened, { status: 'opened', url });
	const published = await publishing;
	await published.waitForURL(url);
	await published.waitForLoadState();
	const publishedIdentity: string = await published.evaluate(() => (globalThis as any).ready);
	const publishedInitialStorage: Record<string, string> = await published.evaluate(() => (globalThis as any).initialStorage);
	assert.notDeepEqual(publishedInitialStorage, parentStorage, 'published navigation seeds a fresh identity before the child document starts');
	assert.ok(Object.values(publishedInitialStorage).includes(publishedIdentity));
	assert.notEqual(publishedIdentity, parentIdentity);
	assert.notEqual(publishedIdentity, cloneIdentity);
	assert.equal(await published.evaluate(() => window.opener), null);
	assert.equal(parent.url(), url);
	assert.equal(await parent.evaluate(() => (globalThis as any).workspaceSession.identity), parentIdentity);
	assert.deepEqual(await parent.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))), parentStorage);
	assert.equal(await parent.evaluate(async () => (await navigator.locks.query()).held!.length), 3);

	await clone.close();
	await parent.waitForFunction(async () => (await navigator.locks.query()).held!.length === 2);
	await published.close();
	await parent.waitForFunction(async () => (await navigator.locks.query()).held!.length === 1);
	await parent.reload();
	assert.equal(await parent.evaluate(() => (globalThis as any).ready), parentIdentity);
	assert.equal(await parent.evaluate(async () => (await navigator.locks.query()).held!.length), 1);
});
