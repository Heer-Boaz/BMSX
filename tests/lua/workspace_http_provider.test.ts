import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpWorkspaceRecordProvider } from '../../ide/browser/workspace_records';

test('browser file provider coalesces session admission and keeps its capability out of URLs and file payloads', async t => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let admissions = 0;
	const requests: { url: string; init: RequestInit }[] = [];
	t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
		if (url === '/__bmsx__/session') {
			admissions++;
			assert.equal(new Headers(init.headers).get('X-BMSX-Client'), 'studio');
			await gate;
			return Response.json({ workspaceToken: 'local-capability' });
		}
		requests.push({ url, init });
		assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer local-capability');
		assert.ok(!url.includes('local-capability') && !String(init.body).includes('local-capability'));
		return url.includes('directory=') ? Response.json([]) : new Response(null, { status: init.method === 'GET' ? 404 : 204 });
	});
	const provider = new HttpWorkspaceRecordProvider();
	const writes = [provider.write('source.lua', { contents: 'return 1', updatedAt: 1 }, true),
		provider.read('missing.lua'), provider.readDirectory('cart'), provider.delete('old.lua')];
	assert.equal(admissions, 1);
	assert.equal(requests.length, 0);
	release();
	assert.deepEqual(await Promise.all(writes), [undefined, null, [], undefined]);
	assert.equal(admissions, 1);
	assert.equal(requests.length, 4);
});

test('server restart retires a capability once; concurrent unauthorized requests join one new admission', async t => {
	let generation = 1, admissions = 0, writes = 0, rejected = 0;
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
		if (url === '/__bmsx__/session') { admissions++; return Response.json({ workspaceToken: `session-${generation}` }); }
		if (new Headers(init.headers).get('Authorization') !== `Bearer session-${generation}`) {
			rejected++; if (rejected === 2) release(); await gate;
			return new Response(null, { status: 401 });
		}
		if (init.method === 'PUT') { writes++; return new Response(null, { status: 204 }); }
		return Response.json({ contents: 'current', updatedAt: 1 });
	});
	const provider = new HttpWorkspaceRecordProvider();
	await provider.read('source.lua');
	generation++;
	await Promise.all([provider.write('a.lua', { contents: 'a', updatedAt: 2 }, true), provider.write('b.lua', { contents: 'b', updatedAt: 2 }, true)]);
	assert.equal(admissions, 2);
	assert.equal(writes, 2, 'unauthorized requests never executed a write; replay admits each write exactly once');
	assert.equal(rejected, 2);
});

test('lost admission can reconnect; transport/write failures and repeated unauthorized results are not replay loops', async t => {
	const provider = new HttpWorkspaceRecordProvider();
	let admissionStatus = 503, fileStatus = 500, admissions = 0, files = 0;
	t.mock.method(globalThis, 'fetch', async (url: string) => {
		if (url === '/__bmsx__/session') {
			admissions++;
			return admissionStatus === 200 ? Response.json({ workspaceToken: 'new-session' }) : new Response('unavailable', { status: admissionStatus });
		}
		files++; return new Response(null, { status: fileStatus });
	});
	await assert.rejects(provider.read('a.lua'), /Session unavailable/);
	assert.equal(files, 0);
	admissionStatus = 200;
	await assert.rejects(provider.write('a.lua', { contents: 'a', updatedAt: 1 }, true), /Failed to write/);
	assert.equal(admissions, 2); assert.equal(files, 1);
	fileStatus = 401;
	await assert.rejects(provider.write('a.lua', { contents: 'a', updatedAt: 1 }, true), /Failed to write/);
	assert.equal(admissions, 3); assert.equal(files, 3, 'one rejected-session renewal, never unbounded replay');
});
