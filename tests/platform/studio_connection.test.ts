import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { StudioSessions } from '../../hosts/node/studio/sessions';

// Real HTTP streaming and browser fetch cancellation. No assistant process or emulator needed.
test('window registration recovers, expires authority, and retires on suspension without replay', { timeout: 45000 }, async t => {
	let sessions = new StudioSessions(), token = 'first', attempts = 0, heartbeats = 0, silent = false;
	const server = createServer(async (req, res) => {
		if (req.url === '/') { res.end('<!doctype html><title>connection</title>'); return; }
		if (req.url === '/__bmsx__/session') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workspaceToken: token })); return; }
		if (req.url === '/__bmsx__/studio/connect') attempts++;
		if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
		if (req.url === '/__bmsx__/studio/heartbeat') {
			heartbeats++;
			if (silent) return; // blackhole the acknowledgement; both peers have deadlines.
		}
		await sessions.handle(req, res, req.url!);
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const browser = await chromium.launch({ args: ['--no-sandbox'] });
	t.after(async () => { await browser.close(); sessions.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
	const page = await browser.newPage();
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	await page.goto(address);
	const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
		import { StudioHttpSession } from './ide/browser/http_session';
		import { StudioServerConnection } from './ide/browser/server_connection';
		globalThis.states = []; globalThis.closedContexts = 0;
		globalThis.channel = new StudioServerConnection(new StudioHttpSession(), {title:'Probe',url:location.href,tools:true,builds:false}, {
			open(signal) { signal.addEventListener('abort', () => globalThis.closedContexts++); return {}; }
		}, () => {}, (state) => globalThis.states.push(state));
		globalThis.channel.resume();
	` }, bundle: true, platform: 'browser', format: 'iife', write: false });
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const ready = () => page.waitForFunction(() => (globalThis as any).channel.state === 'connected');
	await ready();
	const first = sessions.list()[0].id;
	await sessions.invoke(first, { type: 'open', context: 'old' }, new AbortController().signal);
	const pending = sessions.invoke(first, { type: 'call', context: 'old', name: 'not-replayed', arguments: {} }, new AbortController().signal);
	// A server restart invalidates admission, registration and every pending tool reply.
	const observed = pending.catch(error => error);
	sessions.close(); sessions = new StudioSessions(); token = 'replacement';
	await page.waitForFunction(id => (globalThis as any).channel.sessionId !== id && (globalThis as any).channel.state === 'connected', first);
	assert.ok(await observed instanceof Error);
	assert.notEqual(sessions.list()[0].id, first);
	assert.equal(await page.evaluate(() => (globalThis as any).closedContexts), 1);
	await assert.rejects(sessions.invoke(first, { type: 'open', context: 'stale' }, new AbortController().signal));
	await page.evaluate(() => { const c = (globalThis as any).channel; c.suspend(); c.wake(); c.suspend(); });
	await page.waitForFunction(() => (globalThis as any).channel.sessionId === undefined);
	const stopped = attempts;
	await page.waitForTimeout(600);
	assert.equal(attempts, stopped);
	await page.evaluate(() => { const c = (globalThis as any).channel; c.resume(); c.resume(); c.wake(); });
	await ready(); assert.equal(attempts, stopped + 1);
	const beforeSilent = sessions.list()[0].id, start = performance.now(); silent = true;
	await page.waitForFunction(id => (globalThis as any).channel.sessionId !== id && (globalThis as any).channel.state === 'connected', beforeSilent, { timeout: 28000 });
	silent = false;
	console.log('silent-loss recovery ms', Math.round(performance.now() - start), 'registration attempts', attempts, 'heartbeat acknowledgements', heartbeats);
	assert.ok(heartbeats > 0); assert.ok(attempts < 8);
	await page.evaluate(() => (globalThis as any).channel.dispose());
	await page.waitForFunction(() => (globalThis as any).channel.sessionId === undefined);
	assert.equal(sessions.list().length, 0);
});
