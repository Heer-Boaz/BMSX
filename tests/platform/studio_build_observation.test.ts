import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { StudioBuildJob, StudioBuildRequest } from '../../hosts/common/studio_builds';
import type { StudioProjectAdmission } from '../../hosts/common/studio_projects';
import type { RomArtifact, RomBuildUnit } from '../../toolchain/ts/rompack/build_manifest';
import { loadPublishedBuild } from '../../ide/browser/published_media';
import { StudioHttpSession } from '../../ide/browser/http_session';
import type { PublishedBuildOpenResult } from '../../ide/workbench/services/builds';

// Exercise browser storage and independently ordered HTTP/stream observations, not UI copy.
test('published navigation reports browser policy denial and an allowed gesture opens an isolated exact-build tab', { timeout: 30000 }, async t => {
	const requestId = '00000000-0000-4000-8000-000000000001';
	const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
		import { openPublishedBuild } from './ide/browser/published_media';
		const open = () => { globalThis.result = openPublishedBuild('${requestId}'); };
		document.querySelector('button').onclick = open;
		if (location.search.includes('blocked=1')) open();
	` }, bundle: true, platform: 'browser', format: 'iife', write: false });
	const server = createServer((req, res) => {
		if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
		else {
			if (req.url!.includes('blocked=1')) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-same-origin');
			res.end('<!doctype html><button>Open build</button><script src="/probe.js"></script>');
		}
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const browser = await chromium.launch({ args: ['--no-sandbox'], ignoreDefaultArgs: ['--disable-popup-blocking'] });
	t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const context = await browser.newContext(), page = await context.newPage();
	const original = `${address}/studio.debug.html?rom=original.debug.rom#original`;
	const published = `${address}/studio.debug.html?build=${requestId}`;
	await page.goto(`${address}/studio.debug.html?rom=original.debug.rom&blocked=1`);
	const denied: PublishedBuildOpenResult = await page.evaluate(() => (globalThis as any).result);
	assert.deepEqual(denied, { status: 'blocked', url: published });
	assert.equal(context.pages().length, 1, 'denied navigation is not retried or redirected into the current page');
	await page.goto(original);
	const opened = context.waitForEvent('page');
	await page.getByRole('button').click();
	const child = await opened;
	await child.waitForURL(published);
	assert.equal(await child.evaluate(() => window.opener), null);
	assert.equal(page.url(), original);
	assert.deepEqual(await page.evaluate(() => (globalThis as any).result), { status: 'opened', url: published });
});

test('published build admission retains the exact receipt project even when artifact bytes are shared', { timeout: 30000 }, async t => {
	const firstId = '00000000-0000-4000-8000-000000000001', secondId = '00000000-0000-4000-8000-000000000002';
	const archiveId = '00000000-0000-4000-8000-000000000003', pendingId = '00000000-0000-4000-8000-000000000004';
	const unknownId = '00000000-0000-4000-8000-000000000006';
	const firstProject: StudioProjectAdmission = { target: 'cpu_soak',
		system: { id: '10000000-0000-4000-8000-000000000001', projectRoot: 'bios' },
		cartridge: { id: '10000000-0000-4000-8000-000000000002', projectRoot: 'carts/cpu_soak' } };
	// The source roots and bytes can be identical without making these the same admitted contexts.
	const secondProject: StudioProjectAdmission = { target: 'cpu_soak',
		system: { ...firstProject.system, id: '20000000-0000-4000-8000-000000000001' },
		cartridge: { ...firstProject.cartridge, id: '20000000-0000-4000-8000-000000000002' } };
	const system: RomBuildUnit = { key: 'system-key', name: 'bios',
		recipe: { domain: 'system', debug: true, optLevel: 0, projectRoot: 'bios', toolchain: 'test' },
		inputs: 'system-inputs', outputs: [{ file: 'system.rom', digest: 'system-digest' }] };
	const artifact: RomArtifact = { id: 'a'.repeat(64), target: 'cpu_soak', system,
		cart: { key: 'cart-key', name: 'cpu_soak',
			recipe: { domain: 'cart', debug: true, optLevel: 0, projectRoot: 'carts/cpu_soak', toolchain: 'test' },
			inputs: 'cart-inputs', outputs: [{ file: 'cart.rom', digest: 'cart-digest' }] } };
	const firstJob: StudioBuildJob = { request: { requestId: firstId, target: 'cpu_soak', debug: true, optLevel: 0 },
		state: 'completed', phase: 'Published', acceptedAt: 1, updatedAt: 2,
		version: { generation: 1, sequence: 1 }, artifact: artifact.id, project: firstProject };
	const secondJob: StudioBuildJob = { ...firstJob, request: { ...firstJob.request, requestId: secondId }, project: secondProject };
	const jobs = new Map<string, StudioBuildJob>([
		[firstId, firstJob], [secondId, secondJob],
		[archiveId, { ...firstJob, request: { ...firstJob.request, requestId: archiveId }, project: undefined }],
		[pendingId, { ...firstJob, request: { ...firstJob.request, requestId: pendingId }, state: 'publishing' }],
	]);
	const requests: string[] = [];
	const artifactPath = `/__bmsx__/builds/artifacts/${artifact.id}`;
	const server = createServer((req, res) => {
		if (req.url === '/__bmsx__/session') { res.end(JSON.stringify({ workspaceToken: 'test' })); return; }
		requests.push(req.url!);
		if (req.url!.startsWith('/__bmsx__/builds/jobs/')) {
			const job = jobs.get(req.url!.split('/').pop()!);
			if (job === undefined) { res.writeHead(404).end('Build not found'); return; }
			res.end(JSON.stringify(job)); return;
		}
		if (req.url === artifactPath) { res.end(JSON.stringify(artifact)); return; }
		if (req.url === `${artifactPath}/system.rom`) { res.end(Buffer.from([1, 3, 5])); return; }
		if (req.url === `${artifactPath}/cart.rom`) { res.end(Buffer.from([2, 4, 6])); return; }
		res.writeHead(404).end();
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const session = new StudioHttpSession(address);
	for (const [requestId, project] of [[firstId, firstProject], [secondId, secondProject]] as const) {
		requests.length = 0;
		const opened = await loadPublishedBuild(session, requestId);
		assert.deepEqual(opened.project, project);
		assert.deepEqual(opened.media, { systemRom: new Uint8Array([1, 3, 5]), cartridgeSlots: [new Uint8Array([2, 4, 6]), null] });
		assert.deepEqual(requests.slice(0, 2), [`/__bmsx__/builds/jobs/${requestId}`, artifactPath]);
		assert.deepEqual(requests.slice(2).sort(), [`${artifactPath}/cart.rom`, `${artifactPath}/system.rom`]);
	}
	for (const requestId of [unknownId, pendingId, archiveId]) {
		requests.length = 0;
		await assert.rejects(loadPublishedBuild(session, requestId));
		assert.deepEqual(requests, [`/__bmsx__/builds/jobs/${requestId}`], 'rejected admission never reads artifact metadata or media');
	}
});

test('build receipts survive multiple windows and HTTP/stream reordering', { timeout: 30000 }, async t => {
	const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
		import { HttpWorkspaceBuilds } from './ide/browser/builds';
		import { StudioHttpSession } from './ide/browser/http_session';
		globalThis.client = new HttpWorkspaceBuilds(new StudioHttpSession(), () => {});
	` }, bundle: true, platform: 'browser', format: 'iife', write: false });
	const jobs = new Map<string, StudioBuildJob>();
	let sequence = 0, lostAcknowledgement = true, puts = 0;
	let delayedRead: ((send: () => void) => void) | undefined;
	const server = createServer(async (req, res) => {
		if (req.url === '/') { res.end('<!doctype html><script src="/probe.js"></script>'); return; }
		if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
		if (req.url === '/__bmsx__/session') { res.end(JSON.stringify({ workspaceToken: 'test' })); return; }
		const id = req.url!.split('/').pop()!;
		if (req.method === 'PUT') {
			let body = ''; for await (const part of req) body += part;
			const request = JSON.parse(body) as StudioBuildRequest;
			jobs.set(id, { request, state: 'queued', phase: 'Waiting', acceptedAt: sequence, updatedAt: sequence,
				version: { generation: 1, sequence: ++sequence } });
			puts++;
			if (lostAcknowledgement) {
				// A truncated acknowledgement, not a refused connection that the browser could transparently retry.
				res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' }); res.write('{');
				setImmediate(() => res.destroy()); return;
			}
		}
		const body = JSON.stringify(jobs.get(id));
		if (req.method === 'GET' && delayedRead !== undefined) delayedRead(() => res.end(body));
		else res.end(body);
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const browser = await chromium.launch({ args: ['--no-sandbox'] });
	t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const context = await browser.newContext(), first = await context.newPage(), second = await context.newPage();
	await first.goto(address); await second.goto(address);
	await first.evaluate(() => (globalThis as any).client.submit('cpu_soak', true, 3).catch(String));
	const firstId = [...jobs.keys()][0];
	await second.waitForFunction(id => (globalThis as any).client.pending.some((request: StudioBuildRequest) => request.requestId === id), firstId);
	await second.evaluate(() => (globalThis as any).client.snapshot({ generation: 1, revision: 0, jobs: [] }));
	await second.evaluate(() => (globalThis as any).client.submit('cpu_soak', false, 0).catch(String));
	const secondId = [...jobs.keys()][1];
	await first.reload();
	assert.deepEqual((await first.evaluate(() => (globalThis as any).client.pending.map((r: StudioBuildRequest) => r.requestId))).sort(), [firstId, secondId].sort());
	assert.equal(puts, 2);
	await first.evaluate(id => (globalThis as any).client.get(id), firstId);
	await second.waitForFunction(() => (globalThis as any).client.pending.length === 1);
	assert.equal(await second.evaluate(() => (globalThis as any).client.pending[0].requestId), secondId);
	await second.evaluate(id => (globalThis as any).client.forget(id), secondId);
	await first.waitForFunction(() => (globalThis as any).client.pending.length === 0);
	// A queued storage event cannot bring an acknowledged receipt back into memory.
	await first.evaluate(request => {
		const key = `bmsx-build-requests::${request.requestId}`;
		window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key, newValue: JSON.stringify(request) }));
	}, jobs.get(firstId)!.request);
	assert.equal(await first.evaluate(() => (globalThis as any).client.pending.length), 0);

	lostAcknowledgement = false;
	const baseline = sequence;
	const accepted: StudioBuildJob = await first.evaluate(() => (globalThis as any).client.submit('cpu_soak', true, 2));
	const id = accepted.request.requestId;
	assert.equal(await first.evaluate(id => (globalThis as any).client.jobs.find((job: StudioBuildJob) => job.request.requestId === id).state, id), 'queued');
	await first.evaluate(revision => (globalThis as any).client.snapshot({ generation: 1, revision, jobs: [] }), baseline);
	assert.ok(await first.evaluate(id => (globalThis as any).client.jobs.some((job: StudioBuildJob) => job.request.requestId === id), id));
	await first.evaluate(job => (globalThis as any).client.change({ revision: job.version.sequence, job }), accepted);
	const running: StudioBuildJob = { ...accepted, state: 'running', phase: 'Compile', version: { generation: 1, sequence: ++sequence } };
	jobs.set(id, running);
	await first.evaluate(job => (globalThis as any).client.change({ revision: job.version.sequence, job }), running);
	const arrived = Promise.withResolvers<() => void>(); delayedRead = arrived.resolve;
	await first.evaluate(id => { (globalThis as any).reading = (globalThis as any).client.get(id); }, id);
	const send = await arrived.promise;
	const completed: StudioBuildJob = { ...running, state: 'completed', phase: 'Published', version: { generation: 1, sequence: ++sequence } };
	jobs.set(id, completed);
	await first.evaluate(job => (globalThis as any).client.change({ revision: job.version.sequence, job }), completed);
	delayedRead = undefined; send();
	const read: StudioBuildJob = await first.evaluate(() => (globalThis as any).reading);
	assert.equal(read.state, 'completed');
	assert.equal(await first.evaluate(id => (globalThis as any).client.jobs.find((job: StudioBuildJob) => job.request.requestId === id).state, id), 'completed');

	// Conversely, a final HTTP read may arrive before buffered running/snapshot events.
	await second.evaluate(job => (globalThis as any).client.snapshot({ generation: 1, revision: job.version.sequence, jobs: [job] }), accepted);
	await second.evaluate(id => (globalThis as any).client.get(id), id);
	await second.evaluate(job => {
		(globalThis as any).client.change({ revision: job.version.sequence, job });
		(globalThis as any).client.snapshot({ generation: 1, revision: job.version.sequence, jobs: [job] });
	}, running);
	assert.equal(await second.evaluate(id => (globalThis as any).client.jobs.find((job: StudioBuildJob) => job.request.requestId === id).state, id), 'completed');
	assert.equal(puts, 3);
	await context.close();
});

test('closing a Build Output reader aborts actual metadata and log fetches without cancelling its producer', { timeout: 30000 }, async t => {
	const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
		import { HttpWorkspaceBuilds } from './ide/browser/builds';
		import { StudioHttpSession } from './ide/browser/http_session';
		globalThis.client = new HttpWorkspaceBuilds(new StudioHttpSession(), () => {});
	` }, bundle: true, platform: 'browser', format: 'iife', write: false });
	let admitted = Promise.withResolvers<string>();
	const methods: string[] = [];
	const server = createServer((req, res) => {
		if (req.url === '/') { res.end('<!doctype html><script src="/probe.js"></script>'); return; }
		if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
		if (req.url === '/__bmsx__/session') { res.end(JSON.stringify({ workspaceToken: 'test' })); return; }
		methods.push(req.method!); admitted.resolve(req.url!);
		// Leave the finite reader request in flight. The browser owns its cancellation, not a build job action.
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const browser = await chromium.launch({ args: ['--no-sandbox'] });
	t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, page = await browser.newPage();
	await page.goto(origin);
	for (const method of ['get', 'log']) {
		admitted = Promise.withResolvers<string>();
		await page.evaluate(method => {
			const root = globalThis as any; root.controller = new AbortController();
			root.result = root.client[method]('retained-request', root.controller.signal).then(() => 'unexpected success', (error: Error) => error.name);
		}, method);
		assert.equal(await admitted.promise, `/__bmsx__/builds/jobs/retained-request${method === 'log' ? '/log' : ''}`);
		await page.evaluate(() => (globalThis as any).controller.abort());
		assert.equal(await page.evaluate(() => (globalThis as any).result), 'AbortError');
	}
	assert.deepEqual(methods, ['GET', 'GET'], 'reader close never sends producer cancellation or resubmission');
});
