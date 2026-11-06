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

test('offline collection retains current/publication outputs, not recent job media, and preserves collected request receipts', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-references-')), store = new RomArtifactStore(root);
	t.after(() => rm(root, { recursive: true, force: true }));
	const artifacts = [];
	for (let version = 1; version <= 55; version++) artifacts.push(await publishArtifact(store, version));
	const requestId = randomUUID(), ledger = await BuildLedger.open(root);
	const record: StudioBuildJob = { artifactAvailable: false, request: { requestId, target: 'test', debug: true, optLevel: 0 },
		state: 'completed', phase: 'Published', acceptedAt: 1, updatedAt: 1, version: { generation: 1, sequence: 1 }, artifact: artifacts[0].id };
	ledger.record(record); ledger.close();
	const latestRequest = randomUUID(), newer = await BuildLedger.open(root);
	newer.record({ ...record, request: { ...record.request, requestId: latestRequest }, acceptedAt: 55, artifact: artifacts[54].id }); newer.close();
	await store.withSharedAccess(async () => {
		await store.retain('publications/published', artifacts[1].id);
		await store.retain('sessions/previous-server', artifacts[2].id);
	});
	const plan = await collectOfflineBuilds(store, false), result = await collectOfflineBuilds(store, true);
	assert.deepEqual(new Set(plan.removed), new Set(artifacts.filter((_, index) => index !== 1 && index !== 54).map(artifact => artifact.id)));
	assert.deepEqual(result.removed, plan.removed);
	await assert.rejects(store.read(artifacts[0].id), { code: 'ENOENT' });
	assert.equal((await store.read(artifacts[1].id)).id, artifacts[1].id);
	await assert.rejects(access(join(root, 'refs/sessions/previous-server')), { code: 'ENOENT' });
	const receipts = await BuildLedger.open(root);
	try {
		assert.equal(receipts.read(requestId)!.state, 'completed');
		assert.equal(receipts.read(requestId)!.artifact, artifacts[0].id);
		assert.equal(receipts.read(requestId)!.artifactAvailable, false);
		assert.equal(receipts.read(latestRequest)!.artifactAvailable, true);
	} finally { receipts.close(); }
});

test('startup adopts the last selected result even when its cached files are older than an unselected publication', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-startup-')), store = new RomArtifactStore(root);
	const old = await publishArtifact(store, 1); await publishArtifact(store, 2);
	const requestId = randomUUID(), ledger = await BuildLedger.open(root);
	ledger.record({ artifactAvailable: false, request: { requestId, target: 'test', debug: true, optLevel: 0 }, state: 'completed', phase: 'Published',
		acceptedAt: 1, updatedAt: 1, version: { generation: 1, sequence: 1 }, artifact: old.id }); ledger.close();
	const projects = new WorkspaceProjects(process.cwd(), join(root, 'workspace'));
	const jobs = await StudioBuildJobs.open(process.cwd(), root, projects);
	t.after(async () => { await jobs.close(); await projects.close(); await rm(root, { recursive: true, force: true }); });
	assert.deepEqual([...(await store.currentArtifacts()).values()], [old.id]);
	assert.equal(jobs.get(requestId)!.artifactAvailable, true);
	await assert.rejects(access(join(root, 'refs/jobs', requestId)), { code: 'ENOENT' });
	assert.deepEqual((await store.collect({ apply: true })).removed, []);
});

test('a collected latest receipt does not promote an older published result into the current configuration', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-no-promotion-')), store = new RomArtifactStore(root);
	t.after(() => rm(root, { recursive: true, force: true }));
	const old = await publishArtifact(store, 1), latest = await publishArtifact(store, 2);
	await store.withSharedAccess(() => store.retain('publications/site', old.id));
	await store.collect({ apply: true });
	const ledger = await BuildLedger.open(root);
	for (const [index, artifact] of [old, latest].entries()) ledger.record({
		request: { requestId: randomUUID(), target: 'test', debug: true, optLevel: 0 }, state: 'completed',
		artifact: artifact.id, artifactAvailable: index === 0, phase: 'Published', acceptedAt: index, updatedAt: index,
		version: { generation: ledger.generation, sequence: index } });
	ledger.close();
	await collectOfflineBuilds(store, true);
	assert.equal((await store.currentArtifacts()).size, 0);
	assert.equal((await store.read(old.id)).id, old.id);
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

test('automatic collection publishes output availability changes without losing the completed request or restarting its producer', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-availability-')), store = new RomArtifactStore(root);
	const old = await publishArtifact(store, 1), previousId = randomUUID(), ledger = await BuildLedger.open(root);
	ledger.record({ request: { requestId: previousId, target: 'test', debug: true, optLevel: 0 }, state: 'completed',
		artifact: old.id, artifactAvailable: true, phase: 'Published', acceptedAt: 1, updatedAt: 1, version: { generation: 1, sequence: 1 } }); ledger.close();
	const projects = new WorkspaceProjects(process.cwd(), join(root, 'workspace'));
	const jobs = await StudioBuildJobs.open(process.cwd(), root, projects);
	const replacement = await publishArtifact(store, 2);
	await store.withSharedAccess(() => store.retainCurrent(replacement));
	const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), retired = Promise.withResolvers<StudioBuildJob>();
	const collection = withArtifactStoreLock(root, 'exclusive', async () => { entered.resolve(); await release.promise; });
	const stop = jobs.subscribe(({ job }) => { if (job.request.requestId === previousId && !job.artifactAvailable) retired.resolve(job); });
	t.after(async () => { release.resolve(); await collection; stop(); await jobs.close(); await projects.close(); await rm(root, { recursive: true, force: true }); });
	await entered.promise;
	const queued = { requestId: randomUUID(), target: 'cpu_soak', debug: true, optLevel: 0 as const };
	await jobs.admit(queued); await jobs.cancel(queued.requestId);
	release.resolve(); await collection;
	const receipt = await retired.promise;
	assert.equal(receipt.state, 'completed'); assert.equal(receipt.artifact, old.id);
	assert.equal(jobs.get(previousId)!.artifactAvailable, false);
	assert.equal((await jobs.admit(receipt.request)).artifactAvailable, false, 'reconciling an expired result does not produce a second build');
	await assert.rejects(store.read(old.id), { code: 'ENOENT' });
});

test('a connected build-backed browser retains its media independently of recent jobs and releases it on disconnect', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-browser-media-')), store = new RomArtifactStore(root);
	const old = await publishArtifact(store, 1);
	const requestId = randomUUID(), ledger = await BuildLedger.open(root);
	ledger.record({ artifactAvailable: false, request: { requestId, target: 'test', debug: true, optLevel: 0 }, state: 'completed', phase: 'Published',
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
	// A newer selection replaces the current slot, not the browser's independent lifetime.
	const replacement = await publishArtifact(store, 2);
	await store.withSharedAccess(() => store.retainCurrent(replacement));
	assert.deepEqual((await store.collect({ apply: true })).removed, []);
	lifetime.abort(); await disconnected.promise; await sessions.close();
	assert.deepEqual((await store.collect({ apply: true })).removed, [old.id]);
});
