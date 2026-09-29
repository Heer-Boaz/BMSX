import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { StudioBuildJob, StudioBuildRequest } from '../../hosts/common/studio_builds';

// Exercise browser storage and independently ordered HTTP/stream observations, not UI copy.
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
