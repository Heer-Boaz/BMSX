import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuildStoreLockedError } from '../../hosts/node/builds/errors';
import { BuildLedger } from '../../hosts/node/builds/ledger';
import { collectOfflineBuilds } from '../../hosts/node/builds/maintenance';
import { StudioBuildJobs } from '../../hosts/node/builds/jobs';
import { WorkspaceProjects } from '../../hosts/node/workspace/projects';
import { StudioSessions } from '../../hosts/node/studio/sessions';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { RomArtifactStore } from '../../scripts/rompacker/artifacts';
import { withArtifactStoreLock } from '../../scripts/rompacker/artifact_lock';
import { publishArtifact } from '../helpers/rom_artifact';

test('offline collection cannot bypass the live workspace server ownership', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-collection-')), store = new RomArtifactStore(root);
	const ledger = await BuildLedger.open(root);
	t.after(async () => { ledger.close(); await rm(root, { recursive: true, force: true }); });
	const artifact = await publishArtifact(store, 1);
	await assert.rejects(collectOfflineBuilds(store, true), BuildStoreLockedError);
	assert.equal((await store.read(artifact.id)).id, artifact.id);
});

test('offline collection preserves durable recent jobs and publications and retires only the previous server session roots', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-references-')), store = new RomArtifactStore(root);
	t.after(() => rm(root, { recursive: true, force: true }));
	const artifacts = [];
	for (let version = 1; version <= 55; version++) artifacts.push(await publishArtifact(store, version));
	const requestId = randomUUID(), ledger = await BuildLedger.open(root);
	const record: StudioBuildJob = { request: { requestId, target: 'test', debug: true, optLevel: 0 },
		state: 'completed', phase: 'Published', acceptedAt: 1, updatedAt: 1, version: { generation: 1, sequence: 1 }, artifact: artifacts[0].id };
	ledger.record(record); ledger.close();
	await store.withSharedAccess(async () => {
		await store.retain('publications/published', artifacts[1].id);
		await store.retain('sessions/previous-server', artifacts[2].id);
	});
	const plan = await collectOfflineBuilds(store, false), result = await collectOfflineBuilds(store, true);
	assert.deepEqual(new Set(plan.removed), new Set(artifacts.slice(2, 5).map(artifact => artifact.id)));
	assert.deepEqual(result.removed, plan.removed);
	assert.equal((await store.read(artifacts[0].id)).id, artifacts[0].id);
	assert.equal((await store.read(artifacts[1].id)).id, artifacts[1].id);
	await assert.rejects(access(join(root, 'refs/sessions/previous-server')), { code: 'ENOENT' });
});

test('ordinary server startup registers its recent build media before automatic collection', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-startup-')), store = new RomArtifactStore(root);
	const old = await publishArtifact(store, 1); await publishArtifact(store, 2);
	const requestId = randomUUID(), ledger = await BuildLedger.open(root);
	ledger.record({ request: { requestId, target: 'test', debug: true, optLevel: 0 }, state: 'completed', phase: 'Published',
		acceptedAt: 1, updatedAt: 1, version: { generation: 1, sequence: 1 }, artifact: old.id }); ledger.close();
	const projects = new WorkspaceProjects(process.cwd(), join(root, 'workspace'));
	const jobs = await StudioBuildJobs.open(process.cwd(), root, projects);
	t.after(async () => { await jobs.close(); await projects.close(); await rm(root, { recursive: true, force: true }); });
	assert.equal(await readFile(join(root, 'refs/jobs', requestId), 'utf8'), old.id);
	assert.deepEqual((await store.collect({ keepRecent: 1, apply: true })).removed, []);
});

test('a build waiting for collection remains queued and can be cancelled without starting a producer', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-collection-wait-'));
	const projects = new WorkspaceProjects(process.cwd(), join(root, 'workspace'));
	const jobs = await StudioBuildJobs.open(process.cwd(), root, projects);
	const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
	const collection = withArtifactStoreLock(root, 'exclusive', async () => { entered.resolve(); await release.promise; });
	t.after(async () => { release.resolve(); await collection; await jobs.close(); await projects.close(); await rm(root, { recursive: true, force: true }); });
	await entered.promise;
	const request = { requestId: randomUUID(), target: 'cpu_soak', debug: true, optLevel: 0 as const };
	const states: string[] = [], stop = jobs.subscribe(({ job }) => states.push(job.state));
	await jobs.admit(request);
	assert.equal((await jobs.cancel(request.requestId)).state, 'cancelled');
	release.resolve(); await collection; stop();
	assert.deepEqual(states, ['queued', 'cancelled']);
});

test('a connected build-backed browser retains its media independently of recent jobs and releases it on disconnect', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-browser-media-')), store = new RomArtifactStore(root);
	const old = await publishArtifact(store, 1); await publishArtifact(store, 2);
	const requestId = randomUUID(), ledger = await BuildLedger.open(root);
	ledger.record({ request: { requestId, target: 'test', debug: true, optLevel: 0 }, state: 'completed', phase: 'Published',
		acceptedAt: 1, updatedAt: 1, version: { generation: 1, sequence: 1 }, artifact: old.id }); ledger.close();
	const projects = new WorkspaceProjects(process.cwd(), join(root, 'workspace'));
	const jobs = await StudioBuildJobs.open(process.cwd(), root, projects), sessions = new StudioSessions(jobs);
	const disconnected = Promise.withResolvers<void>();
	const server = createServer(async (request, response) => {
		response.once('close', disconnected.resolve);
		await sessions.handle(request, response, '/__bmsx__/studio/connect');
	});
	t.after(async () => {
		await sessions.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
		await jobs.close(); await projects.close(); await rm(root, { recursive: true, force: true });
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, lifetime = new AbortController();
	const response = await fetch(`${origin}/__bmsx__/studio/connect`, { method: 'POST', signal: lifetime.signal,
		headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Retention', url: `${origin}/?build=${requestId}`, tools: true, builds: true }) });
	await response.body!.getReader().read();
	const session = sessions.list()[0];
	assert.equal(await readFile(join(root, 'refs/sessions', session.id), 'utf8'), old.id);
	// Model the recent-job owner's eviction while the browser's independent lifetime continues.
	await store.withSharedAccess(() => store.release(`jobs/${requestId}`));
	assert.deepEqual((await store.collect({ keepRecent: 1, apply: true })).removed, []);
	lifetime.abort(); await disconnected.promise; await sessions.close();
	assert.deepEqual((await store.collect({ keepRecent: 1, apply: true })).removed, [old.id]);
});
