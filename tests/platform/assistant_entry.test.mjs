import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { renderStudioPage, STUDIO_CONFIGURATION_ELEMENT, STANDALONE_STUDIO_CONFIGURATION } from '../../scripts/products/studio_page.ts';

async function fixture(t, host = '127.0.0.1') {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-assistant-entry-'));
	const dist = join(root, 'dist'), bin = join(root, 'bin'), state = join(root, 'state'), trace = join(root, 'codex-calls');
	await mkdir(dist); await mkdir(bin);
	await writeFile(join(dist, 'index.html'), '<!doctype html><p>Studio entry fixture</p>');
	const template = `<!doctype html>${STUDIO_CONFIGURATION_ELEMENT}<p>Studio application</p>`;
	await writeFile(join(dist, 'studio.debug.template.html'), template);
	await writeFile(join(dist, 'studio.debug.html'), renderStudioPage(template, STANDALONE_STUDIO_CONFIGURATION));
	await writeFile(join(root, 'source.lua'), 'return 1');
	// Exercise the actual production entry without touching an account or opening a model connection.
	await writeFile(join(bin, 'codex'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\n[ "$1" = "--version" ] || exit 4\necho codex-cli 0.0.0\n`, { mode: 0o700 });
	const child = spawn(process.execPath, [resolve('scripts/serve-dist.mjs'), '--dir', dist, '--port', '0', '--host', host],
		{ cwd: root, env: { ...process.env, NODE_OPTIONS: '', XDG_STATE_HOME: state, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
	const exited = once(child, 'exit');
	t.after(async () => { child.kill(); await exited; await rm(root, { recursive: true }); });
	let output = '';
	const address = await new Promise((resolveAddress, reject) => {
		child.on('error', reject);
		child.on('exit', code => reject(new Error(`Studio entry exited ${code}: ${output}`)));
		child.stderr.on('data', bytes => { output += bytes; });
		child.stdout.on('data', bytes => {
			output += bytes;
			const match = (host === '0.0.0.0' ? /On your LAN:\n\s+(http:\/\/[\d.]+:\d+)/ : /(http:\/\/localhost:\d+)/).exec(output);
			if (match) resolveAddress(match[1].replace('localhost', '127.0.0.1'));
		});
	});
	const request = (route, init) => fetch(address + route, init);
	return { root, dist, state, bin, trace, child, exited, address, request };
}

test('the ordinary LAN server exposes Studio admission without starting Codex or opening its profile', { timeout: 15000 }, async t => {
	const f = await fixture(t, '0.0.0.0');
	assert.equal((await f.request('/index.html')).status, 200);
	assert.equal((await f.request('/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio', Origin: f.address } })).status, 200);
	assert.equal((await f.request('/__bmsx__/assistant/connect', { method: 'POST' })).status, 401);
	await assert.rejects(access(f.state), { code: 'ENOENT' });
	await assert.rejects(access(f.trace), { code: 'ENOENT' });
});

test('only the Studio application route supplies services; static pages and packaged standalone configuration stay unchanged', async t => {
	const f = await fixture(t);
	const response = await f.request('/studio.debug.html'), html = await response.text();
	const { chromium } = await import('playwright');
	const browser = await chromium.launch({ args: ['--no-sandbox'] });
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.setContent(html);
	assert.deepEqual(await page.evaluate(() => JSON.parse(document.getElementById('bmsx-studio-configuration').dataset.settings)),
		{ workspace: { kind: 'http', baseUrl: '' }, assistant: '', conversations: '', externalTools: '' });
	const standalone = await readFile(join(f.dist, 'studio.debug.html'), 'utf8');
	await page.setContent(standalone);
	assert.deepEqual(await page.evaluate(() => JSON.parse(document.getElementById('bmsx-studio-configuration').dataset.settings)), STANDALONE_STUDIO_CONFIGURATION);
	assert.equal((await f.request('/studio.debug.html', { method: 'HEAD' })).headers.get('Content-Length'), response.headers.get('Content-Length'));
	await writeFile(join(f.dist, 'unrelated.html'), standalone);
	assert.equal(await (await f.request('/unrelated.html')).text(), standalone);
	// Quoted bootstrap data must stay data, not turn into HTML or another capability.
	const configuration = { workspace: { kind: 'browser' }, conversations: '/history?x="<&$&' };
	await page.setContent(renderStudioPage(`<!doctype html>${STUDIO_CONFIGURATION_ELEMENT}`, configuration));
	assert.deepEqual(await page.evaluate(() => JSON.parse(document.getElementById('bmsx-studio-configuration').dataset.settings)), configuration);
	await assert.rejects(access(f.trace), { code: 'ENOENT' });
});

test('the ordinary server authorizes first and opens Codex only on explicit Connect, without a launch flag or loader', { timeout: 15000 }, async t => {
	const f = await fixture(t), { address, child, exited } = f;
	const endpoint = `${address}/__bmsx__/assistant/connect`;
	assert.equal((await f.request('/index.html')).status, 200);
	assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
	assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status, 403);
	await assert.rejects(access(f.state), { code: 'ENOENT' });
	const admission = await fetch(`${address}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' } });
	const { workspaceToken } = await admission.json();
	assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${workspaceToken}` } })).status, 405);
	await assert.rejects(access(f.state), { code: 'ENOENT' });
	await assert.rejects(access(f.trace), { code: 'ENOENT' });
	const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${workspaceToken}` } });
	assert.equal(response.status, 503);
	assert.ok((await response.text()).length > 0, 'a CLI that cannot speak the protocol fails the connect with a reason');
	// A version difference is reported, not refused, so the App Server is launched after the
	// probe. The guarantee is the order and that neither runs before an explicit Connect.
	const invocations = (await readFile(f.trace, 'utf8')).trim().split('\n');
	assert.equal(invocations[0], '--version');
	assert.ok(invocations[1]?.startsWith('app-server --stdio'), invocations[1]);
	await access(join(f.state, 'bmsx', 'studio-codex', 'account'));
	await assert.rejects(access(join(f.state, 'bmsx', 'studio-codex', 'lease')), { code: 'ENOENT' });
	child.kill();
	assert.deepEqual(await exited, [0, null], 'the entry completes its joined shutdown instead of default signal termination');
});

for (const host of ['127.0.0.1', '0.0.0.0']) test(`ordinary server ${host}: real Codex, source IO and joined lease shutdown`, { timeout: 30000 }, async t => {
	const f = await fixture(t, host);
	await rm(join(f.bin, 'codex')); // Use the installed pinned CLI, with only the fixture's empty account profile.
	const admission = await f.request('/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio' } });
	const { workspaceToken } = await admission.json(), headers = { Authorization: `Bearer ${workspaceToken}`, Origin: f.address };
	const response = await f.request('/__bmsx__/assistant/connect', { method: 'POST', headers });
	assert.equal(response.status, 200);
	const lines = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let text = '';
	while (!text.includes('\n')) {
		const part = await lines.read(); assert.equal(part.done, false, 'connection must publish its initial event'); text += part.value;
	}
	const event = JSON.parse(text.slice(0, text.indexOf('\n')));
	assert.equal(event.type, 'connected');
	assert.deepEqual(event.account, { connected: false, requiresLogin: true });
	await access(join(f.state, 'bmsx', 'studio-codex', 'lease'));
	assert.equal((await f.request('/__bmsx__/assistant/connect', { method: 'POST', headers })).status, 409, 'the existing server owns one process lease');
	assert.equal((await f.request('/__bmsx__/lua', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: 'source.lua', contents: 'return 2', updatedAt: 1234567890000 }) })).status, 204);
	assert.equal(await readFile(join(f.root, 'source.lua'), 'utf8'), 'return 2');
	f.child.kill();
	while (!(await lines.read()).done) { /* Drain the connection as the server retires its process. */ }
	assert.deepEqual(await f.exited, [0, null]);
	await assert.rejects(access(join(f.state, 'bmsx', 'studio-codex', 'lease')), { code: 'ENOENT' });
	await assert.rejects(access(join(f.state, 'bmsx', 'studio-codex', 'account', 'auth.json')), { code: 'ENOENT' });
});

test('mobile Chromium uses the ordinary LAN server and shared Studio browser clients without secure-origin overrides', { timeout: 30000 }, async t => {
	const f = await fixture(t, '0.0.0.0');
	await rm(join(f.bin, 'codex'));
	await build({ stdin: { contents: `
		export { AssistantHttpConnection } from './ide/browser/assistant_connection';
		export { StudioHttpSession } from './ide/browser/http_session';
		export { HttpWorkspaceRecordProvider } from './ide/browser/workspace_records';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'esm', target: 'es2024', outfile: join(f.dist, 'client.js') });
	const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	const errors = [], admissions = [];
	page.on('pageerror', error => errors.push(error));
	page.on('request', request => { if (request.url().endsWith('/__bmsx__/session')) admissions.push(request.url()); });
	await page.goto(f.address);
	const result = await page.evaluate(async () => {
		const { AssistantHttpConnection, StudioHttpSession, HttpWorkspaceRecordProvider } = await import('/client.js');
		const session = new StudioHttpSession(), files = new HttpWorkspaceRecordProvider(session), lifetime = new AbortController();
		const events = [];
		const [client, source] = await Promise.all([AssistantHttpConnection.open(session, lifetime.signal, event => events.push(event.type)), files.read('source.lua')]);
		lifetime.abort(); await client.closed;
		await files.write('source.lua', { contents: 'return 3', updatedAt: 1234567890000 }, true);
		return { origin: location.origin, source: source.contents, saved: (await files.read('source.lua')).contents,
			account: client.account, events, secure: isSecureContext, isolated: crossOriginIsolated };
	});
	assert.equal(result.origin, f.address);
	assert.equal(result.source, 'return 1'); assert.equal(result.saved, 'return 3');
	assert.deepEqual(result.account, { connected: false, requiresLogin: true });
	assert.deepEqual(result.events, ['connected', 'configuration', 'usage']);
	assert.equal(admissions.length, 1); assert.deepEqual(errors, []);
	assert.equal(await readFile(join(f.root, 'source.lua'), 'utf8'), 'return 3');
	// This is transport evidence, not a full mobile Studio boot: plain LAN HTTP
	// does not grant the browser features required by the existing audio/runtime.
	assert.equal(result.secure, false); assert.equal(result.isolated, false);
});
