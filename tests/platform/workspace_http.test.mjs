import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture(t, host) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-http-boundary-'));
	const root = join(directory, 'workspace'), dist = join(root, 'dist');
	await mkdir(dist, { recursive: true });
	await writeFile(join(dist, 'index.html'), '<!doctype html><p>Studio</p>');
	await writeFile(join(dist, 'cart.rom'), 'ROM');
	await writeFile(join(root, 'source.lua'), 'return 1');
	await writeFile(join(directory, 'outside.lua'), 'outside');
	await symlink(directory, join(root, 'escape'));
	await symlink(join(directory, 'outside.lua'), join(dist, 'escape.lua'));
	const child = spawn(process.execPath, [resolve('scripts/serve-dist.mjs'), '--dir', dist, '--port', '0',
		...(host === undefined ? [] : ['--host', host])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
	t.after(async () => {
		const exited = once(child, 'exit'); child.kill(); await exited;
		await rm(directory, { recursive: true, force: true });
	});
	let output = '';
	const address = await new Promise((resolveAddress, reject) => {
		child.on('error', reject);
		child.on('exit', code => reject(new Error(`Server exited ${code}: ${output}`)));
		child.stderr.on('data', bytes => { output += bytes; });
		child.stdout.on('data', bytes => {
			output += bytes;
			const match = /http:\/\/localhost:(\d+)/.exec(output);
			if (match) resolveAddress(`http://127.0.0.1:${match[1]}`);
		});
	});
	const request = (route, init = {}) => fetch(address + route, init);
	const session = async () => {
		const response = await request('/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio', Origin: address } });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		return { Authorization: `Bearer ${(await response.json()).workspaceToken}`, Origin: address };
	};
	return { root, directory, address, request, session };
}

test('workspace API rejects unauthenticated reads, enumeration and writes before touching files', async t => {
	const { request, root } = await fixture(t);
	for (const route of ['?path=source.lua', '?directory=']) {
		assert.equal((await request('/__bmsx__/lua' + route)).status, 401);
	}
	const response = await request('/__bmsx__/lua', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: 'source.lua', contents: 'unauthorized', updatedAt: 1 }) });
	assert.equal(response.status, 401);
	assert.equal((await request('/__bmsx__/assistant/connect', { method: 'POST' })).status, 401);
	assert.equal(await readFile(join(root, 'source.lua'), 'utf8'), 'return 1');
});

test('authorized source CRUD preserves timestamps and exclusive creation', async t => {
	const { request, session } = await fixture(t);
	const headers = await session();
	assert.equal((await request('/__bmsx__/assistant/connect', { method: 'POST', headers })).status, 503, 'ordinary static serving does not enable a process endpoint');
	const put = (contents, extra = {}) => request('/__bmsx__/lua', { method: 'PUT',
		headers: { ...headers, 'Content-Type': 'application/json', ...extra },
		body: JSON.stringify({ path: 'new/nested/source.lua', contents, updatedAt: 1234567890000 }) });
	assert.equal((await put('return 2', { 'If-None-Match': '*' })).status, 204);
	assert.equal((await put('overwrite', { 'If-None-Match': '*' })).status, 412);
	assert.equal((await put('return 3')).status, 204);
	const response = await request('/__bmsx__/lua?path=new/nested/source.lua', { headers });
	assert.equal(response.headers.get('access-control-allow-origin'), null);
	assert.deepEqual(await response.json(), { path: 'new/nested/source.lua', contents: 'return 3', updatedAt: 1234567890000 });
	const entries = await request('/__bmsx__/lua?directory=new/nested', { headers });
	assert.deepEqual(await entries.json(), [{ name: 'source.lua', type: 'file' }]);
	assert.equal((await request('/__bmsx__/lua?path=new/nested/source.lua', { method: 'DELETE', headers })).status, 204);
	assert.equal((await request('/__bmsx__/lua?path=new/nested/source.lua', { headers })).status, 404);
});

test('cross-origin, opaque-origin, rebinding and preflight requests cannot acquire or use workspace authority', async t => {
	const { request, session, address, root } = await fixture(t);
	const authorized = await session();
	for (const origin of ['https://untrusted.example', 'null', address.replace('127.0.0.1', 'localhost')]) {
		assert.equal((await request('/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio', Origin: origin } })).status, 403);
		assert.equal((await request('/__bmsx__/lua?path=source.lua', { headers: { ...authorized, Origin: origin } })).status, 403);
		assert.equal((await request('/__bmsx__/lua?path=source.lua', { method: 'DELETE', headers: { ...authorized, Origin: origin } })).status, 403);
	}
	const rebindingStatus = await new Promise((resolveStatus, reject) => {
		const req = httpRequest(address + '/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio', Host: 'rebinding.example' } }, res => {
			res.resume(); resolveStatus(res.statusCode);
		});
		req.on('error', reject); req.end();
	});
	assert.equal(rebindingStatus, 403);
	assert.equal((await request('/__bmsx__/session')).status, 403, 'bootstrap requires a non-simple client request');
	assert.equal((await request('/__bmsx__/session', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
	assert.equal(await readFile(join(root, 'source.lua'), 'utf8'), 'return 1');
});

test('workspace and static paths reject traversal and symlink escapes, including creation', async t => {
	const { request, session, directory } = await fixture(t);
	const headers = await session();
	for (const path of ['../outside.lua', 'escape/outside.lua']) {
		assert.equal((await request('/__bmsx__/lua?path=' + encodeURIComponent(path), { headers })).status, 403);
		assert.equal((await request('/__bmsx__/lua', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
			body: JSON.stringify({ path, contents: 'escape write', updatedAt: 1 }) })).status, 403);
		assert.equal((await request('/__bmsx__/lua?path=' + encodeURIComponent(path), { method: 'DELETE', headers })).status, 403);
	}
	assert.equal((await request('/__bmsx__/lua?directory=escape', { headers })).status, 403);
	assert.equal((await request('/escape.lua')).status, 403);
	assert.equal((await request('/..%2foutside.lua')).status, 403);
	assert.equal(await readFile(join(directory, 'outside.lua'), 'utf8'), 'outside');
});

test('LAN presentation has no workspace capability even through a loopback client', async t => {
	const { request } = await fixture(t, '0.0.0.0');
	assert.equal((await request('/index.html')).status, 200);
	assert.equal((await request('/__bmsx__/carts')).status, 200);
	assert.equal((await request('/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio' } })).status, 403);
	assert.equal((await request('/__bmsx__/lua?path=source.lua')).status, 403);
	assert.equal((await request('/__bmsx__/assistant/connect', { method: 'POST' })).status, 403);
});

test('capabilities are process-local; static presentation has no cross-origin or embedding permission', async t => {
	const first = await fixture(t), second = await fixture(t);
	const headers = await first.session();
	assert.equal((await second.request('/__bmsx__/lua?path=source.lua', { headers: { ...headers, Origin: second.address } })).status, 401);
	const response = await first.request('/index.html');
	assert.equal(response.headers.get('access-control-allow-origin'), null);
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(response.headers.get('x-frame-options'), 'DENY');
	assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
	assert.equal((await first.request('/index.html', { method: 'PUT' })).status, 405);
});
