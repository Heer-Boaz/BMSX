import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StudioBuildJobs } from '../../hosts/node/builds/jobs';
import { compareBuildVersions, isBuildTerminal, type StudioBuildRequest, type StudioBuildJob } from '../../hosts/common/studio_builds';
import { BuildLedger } from '../../hosts/node/builds/ledger';

test('real worker builds, idempotent admission, cancellation and restart reconciliation', { timeout: 120000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-jobs-'));
	let jobs = await StudioBuildJobs.open(process.cwd(), root);
	t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });
	await assert.rejects(StudioBuildJobs.open(process.cwd(), root), /locked/);
	const request: StudioBuildRequest = { requestId: randomUUID(), target: 'cpu_soak', debug: true, optLevel: 0 };
	let running = 0;
	const versions: StudioBuildJob['version'][] = [];
	const completed = Promise.withResolvers<StudioBuildJob>();
	const unwatch = jobs.subscribe(({ job }) => {
		if (job.request.requestId !== request.requestId) return;
		versions.push(job.version);
		if (job.state === 'running') running++;
		if (isBuildTerminal(job.state)) completed.resolve(job);
	});
	const [first, duplicate] = await Promise.all([jobs.admit(request), jobs.admit(request)]);
	assert.deepEqual(first.request, duplicate.request);
	await assert.rejects(jobs.admit({ ...request, optLevel: 3 }));
	const queued = { ...request, requestId: randomUUID() };
	await jobs.admit(queued);
	assert.equal((await jobs.cancel(queued.requestId)).state, 'cancelled');
	const result = await completed.promise; unwatch();
	assert.equal(result.state, 'completed', result.error);
	assert.ok(running > 0);
	for (let index = 1; index < versions.length; index++) assert.ok(compareBuildVersions(versions[index], versions[index - 1]) > 0);
	const artifact = await jobs.artifacts.read(result.artifact!);
	assert.equal(artifact.cart!.name, request.target);
	assert.ok(artifact.system.outputs.length > 1);
	for (const unit of [artifact.system, artifact.cart!]) for (const output of unit.outputs) assert.ok((await readFile(join(jobs.artifacts.directory(artifact.id), output.file))).length > 0);
	assert.equal((await jobs.admit(request)).artifact, result.artifact);
	const interrupted = { ...request, requestId: randomUUID(), target: 'nemesis_s' };
	await jobs.admit(interrupted);
	assert.equal((await jobs.cancel(interrupted.requestId)).state, 'cancelled');
	await jobs.close();
	// Startup reconciles the durable publication intent against the actual commit, never re-executes it.
	const database = new DatabaseSync(join(root, 'jobs.sqlite'));
	database.prepare("UPDATE jobs SET state='publishing', record=json_set(record, '$.state', 'publishing') WHERE id=?").run(request.requestId);
	const lost = { ...first, request: { ...request, requestId: randomUUID() }, state: 'running' };
	database.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?)').run(lost.request.requestId, lost.acceptedAt, lost.state, JSON.stringify(lost));
	database.close();
	jobs = await StudioBuildJobs.open(process.cwd(), root);
	assert.equal((await jobs.get(request.requestId))!.state, 'completed');
	assert.ok(compareBuildVersions(jobs.get(request.requestId)!.version, result.version) > 0);
	assert.equal((await jobs.get(lost.request.requestId))!.state, 'interrupted');
	console.log('artifact', result.artifact, 'system outputs', artifact.system.outputs.length, 'cart outputs', artifact.cart!.outputs.length);
});

test('ledger upgrades existing receipts and orders lifetimes without persisting progress ticks', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-ledger-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const request: StudioBuildRequest = { requestId: randomUUID(), target: 'cpu_soak', debug: true, optLevel: 0 };
	const legacy = { request, state: 'running', phase: 'Compile', acceptedAt: 1, updatedAt: 2 };
	const database = new DatabaseSync(join(root, 'jobs.sqlite'));
	database.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY, accepted_at INTEGER NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL)');
	database.prepare('INSERT INTO jobs VALUES(?, ?, ?, ?)').run(request.requestId, legacy.acceptedAt, legacy.state, JSON.stringify(legacy));
	database.close();
	const original = await BuildLedger.open(root);
	const migrated = original.read(request.requestId)!;
	assert.deepEqual(migrated.request, request);
	assert.equal(migrated.state, legacy.state);
	assert.deepEqual(migrated.version, { generation: 0, sequence: 0 });
	const observedProgress = { generation: original.generation, sequence: 100 };
	original.close();
	const restarted = await StudioBuildJobs.open(process.cwd(), root);
	try {
		const recovered = restarted.get(request.requestId)!;
		assert.equal(recovered.state, 'interrupted');
		assert.ok(compareBuildVersions(recovered.version, observedProgress) > 0);
	} finally { await restarted.close(); }
});

test('existing server exposes the same durable jobs to HTTP and MCP without a browser or account', { timeout: 120000 }, async t => {
	const { spawn } = await import('node:child_process');
	const { once } = await import('node:events');
	const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
	const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
	const { setTimeout: delay } = await import('node:timers/promises');
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-http-'));
	const child = spawn(process.execPath, ['scripts/serve-dist.mjs', '--host', '127.0.0.1', '--port', '0', '--build-store', root], { stdio: ['ignore', 'pipe', 'pipe'] });
	const exit = once(child, 'exit');
	t.after(async () => { child.kill(); await exit; await rm(root, { recursive: true, force: true }); });
	let log = '';
	const address = await new Promise<string>((resolve, reject) => {
		child.stderr.on('data', bytes => { log += bytes; });
		child.on('exit', code => reject(new Error(`Server ${code}: ${log}`)));
		child.stdout.on('data', bytes => { log += bytes; const match = /http:\/\/localhost:\d+/.exec(log); if (match) resolve(match[0].replace('localhost', '127.0.0.1')); });
	});
	assert.equal((await fetch(`${address}/__bmsx__/builds`)).status, 401);
	const { workspaceToken } = await (await fetch(`${address}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' } })).json();
	const headers = { Authorization: `Bearer ${workspaceToken}`, 'Content-Type': 'application/json' };
	const request: StudioBuildRequest = { requestId: randomUUID(), target: 'cpu_soak', debug: true, optLevel: 0 };
	const url = `${address}/__bmsx__/builds/jobs/${request.requestId}`;
	const accepted = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(request) });
	assert.equal(accepted.status, 200); await accepted.body!.cancel(); // Observer discards the acknowledgement; it owns no job lifetime.
	const client = new Client({ name: 'build-probe', version: '1.0.0' });
	const transport = new StreamableHTTPClientTransport(new URL(`${address}/__bmsx__/mcp`), { requestInit: { headers } });
	await client.connect(transport);
	const duplicate = await client.callTool({ name: 'studio_build_cart', arguments: request });
	assert.notEqual(duplicate.isError, true, JSON.stringify(duplicate));
	await transport.terminateSession(); await client.close(); // Work continues without an MCP subscriber too.
	let job: StudioBuildJob;
	do { await delay(100); job = await (await fetch(url, { headers })).json(); } while (!isBuildTerminal(job.state));
	assert.equal(job.state, 'completed', job.error);
	const snapshot = await (await fetch(`${address}/__bmsx__/builds`, { headers })).json();
	assert.equal(snapshot.jobs.length, 1);
	const artifact = await (await fetch(`${address}/__bmsx__/builds/artifacts/${job.artifact}`, { headers })).json();
	const media = await fetch(`${address}/__bmsx__/builds/artifacts/${job.artifact}/${artifact.cart.outputs[0].file}`, { headers });
	assert.equal(media.status, 200); assert.ok((await media.arrayBuffer()).byteLength > 0);
	const malformed = await fetch(`${address}/__bmsx__/builds/jobs/${randomUUID()}`, { method: 'PUT', headers, body: JSON.stringify({ ...request, target: '../outside' }) });
	assert.equal(malformed.status, 400);
});

test('a killed server releases ledger ownership and interrupts, rather than replays, its admitted job', { timeout: 30000 }, async t => {
	const { spawn } = await import('node:child_process');
	const { once } = await import('node:events');
	const { resolve } = await import('node:path');
	const { pathToFileURL } = await import('node:url');
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-killed-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const request: StudioBuildRequest = { requestId: randomUUID(), target: 'cpu_soak', debug: true, optLevel: 2 };
	const program = `import { StudioBuildJobs } from ${JSON.stringify(pathToFileURL(resolve('hosts/node/builds/jobs.ts')).href)};
		const jobs = await StudioBuildJobs.open(${JSON.stringify(process.cwd())}, ${JSON.stringify(root)});
		jobs.subscribe(({job}) => { if(job.state === 'running') process.send('admitted'); });
		await jobs.admit(${JSON.stringify(request)});`;
	const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	const closed = once(child, 'exit'); t.after(async () => { child.kill('SIGKILL'); await closed; });
	await once(child, 'message'); child.kill('SIGKILL'); await closed;
	const replacement = await StudioBuildJobs.open(process.cwd(), root);
	try {
		assert.equal(replacement.get(request.requestId)!.state, 'interrupted');
		assert.equal((await replacement.admit(request)).state, 'interrupted');
		assert.equal(replacement.snapshot().jobs.length, 1);
	} finally { await replacement.close(); }
});
