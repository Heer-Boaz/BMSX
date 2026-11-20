import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StudioToolRequests } from '../../ide/workbench/services/assistant/tool_requests';
import type { WorkspaceToolService } from '../../ide/workbench/services/assistant/tool_service';
import { createStudioServer } from '../helpers/studio_server.mjs';
import { StudioSessions } from '../../hosts/node/studio/sessions';
import type { StudioBuildJobs } from '../../hosts/node/builds/jobs';
import { afterTest } from '../helpers/test_cleanup';

test('an archived artifact without source admission cannot open an authoring Studio or read media', async t => {
	let reads = 0;
	const sessions = new StudioSessions({
		subscribe() { return () => {}; },
		get() { return { state: 'completed', artifactAvailable: true, artifact: 'archived-artifact' }; },
		artifacts: { withSharedAccess: (operation: () => Promise<unknown>) => operation(),
			async read() { reads++; throw new Error('Media must not be read before source admission'); } },
	} as unknown as StudioBuildJobs);
	afterTest(t, () => sessions.close());
	await assert.rejects(sessions.startHeadless({ requestId: randomUUID(), buildRequestId: randomUUID(), sourceAccess: 'review' }));
	assert.equal(reads, 0);
	assert.equal(sessions.list().length, 0);
});

test('a collected build receipt cannot start headless Studio or attempt to read its retired ROM', async t => {
	let reads = 0;
	const sessions = new StudioSessions({
		subscribe() { return () => {}; },
		get() { return { state: 'completed', artifactAvailable: false, artifact: 'collected-artifact', project: {} }; },
		artifacts: { withSharedAccess: (operation: () => Promise<unknown>) => operation(),
			async read() { reads++; throw new Error('Collected media must not be read'); } },
	} as unknown as StudioBuildJobs);
	afterTest(t, () => sessions.close());
	await assert.rejects(sessions.startHeadless({ requestId: randomUUID(), buildRequestId: randomUUID(), sourceAccess: 'review' }));
	assert.equal(reads, 0); assert.equal(sessions.list().length, 0);
});

test('headless Studio workers share save authority, not drafts or MCP lifetimes', { timeout: 180000 }, async t => {
	type Connection = { client: Client; transport: StreamableHTTPClientTransport };
	const connections = new Set<Connection>();
	afterTest(t, async () => {
		for (const { client, transport } of connections) { await transport.terminateSession(); await client.close(); }
	});
	const f = await createStudioServer(t);
	execFileSync('git', ['init', '--quiet'], { cwd: f.root });
	// The ordinary MCP fixture only copies authored text for its prebuilt browser cart.
	// This test builds a tiny independent project, including the real BIOS resources.
	await cp('machine/bios/res', join(f.root, 'machine/bios/res'), { recursive: true });
	await cp('carts/emptycart', join(f.root, 'carts/emptycart'), {
		recursive: true, filter: path => !path.split(/[\\/]/).includes('.bmsx'),
	});
	const connect = async (): Promise<Connection> => {
		const client = new Client({ name: 'studio-headless-acceptance', version: '1.0.0' });
		const transport = new StreamableHTTPClientTransport(new URL(`${f.address}/__bmsx__/mcp`), { requestInit: { headers: f.headers } });
		await client.connect(transport);
		const connection = { client, transport }; connections.add(connection); return connection;
	};
	let current = await connect();
	const call = async (name: string, args: Record<string, unknown> = {}, connection = current): Promise<any> => {
		const result = await connection.client.callTool({ name, arguments: args }) as CallToolResult;
		assert.notEqual(result.isError, true, JSON.stringify(result.content));
		return result.structuredContent!.result;
	};
	const rejected = async (name: string, args: Record<string, unknown>, connection = current) => {
		const result = await connection.client.callTool({ name, arguments: args }) as CallToolResult;
		assert.equal(result.isError, true);
	};
	const readEntry = async (session: string) => {
		const context = await call('studio_open_context', { session });
		const catalog = await call('studio_list_sources', context);
		const entry = catalog.find((resource: { contextId: string; path: string }) => resource.contextId === build.project.cartridge.id && resource.path === 'entry.lua');
		assert.ok(entry);
		const source = await call('studio_read_source', { ...context, resource: entry.resource });
		return { ...context, ...source };
	};
	const savedPath = join(f.root, 'carts/emptycart/entry.lua');
	const original = await readFile(savedPath, 'utf8');
	assert.deepEqual((await call('studio_list_sessions')).sessions, []);
	const buildRequestId = randomUUID();
	await call('studio_build_cart', { requestId: buildRequestId, target: 'emptycart', debug: true, optLevel: 3 });
	let build = (await call('studio_read_build', { requestId: buildRequestId })).job;
	while (build.state === 'queued' || build.state === 'running' || build.state === 'publishing') {
		await delay(100);
		build = (await call('studio_read_build', { requestId: buildRequestId })).job;
	}
	assert.equal(build.state, 'completed', build.error);
	const request = { requestId: randomUUID(), buildRequestId, sourceAccess: 'edit' };
	const [started, duplicate] = await Promise.all([call('studio_start_headless', request), call('studio_start_headless', request)]);
	assert.equal(started.status, 'ready'); assert.equal(duplicate.session.id, started.session.id);
	const first = started.session.id;
	const mediaReference = (session: string) => join(f.root, '.bmsx/builds/refs/sessions', session);
	assert.equal(await readFile(mediaReference(first), 'utf8'), build.artifact, 'the active Studio retains its exact immutable media');
	assert.equal(started.session.kind, 'headless'); assert.equal(started.session.sourceAccess, 'edit');
	assert.equal(started.session.reviewApproval, 'agent');
	assert.equal((await call('studio_list_sessions')).sessions.length, 1);
	await rejected('studio_start_headless', { ...request, sourceAccess: 'review' });
	await rejected('studio_start_headless', { requestId: randomUUID(), buildRequestId: randomUUID(), sourceAccess: 'edit' });
	assert.equal((await call('studio_list_sessions')).sessions.length, 1);
	const firstSource = await readEntry(first);
	assert.equal(firstSource.source, original);
	let runtime = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	while (runtime.operationActive || runtime.activeCartridge < 0) {
		await delay(25);
		runtime = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	}
	assert.equal(runtime.fault, undefined);
	await call('studio_pause_runtime', { toolContext: firstSource.toolContext, target: runtime.target });
	const stepped = await call('studio_step_frames', { toolContext: firstSource.toolContext, target: runtime.target, direction: 'forward', count: 3 });
	assert.equal(stepped.status, 'completed');
	assert.equal(stepped.after.videoTick - stepped.before.videoTick, 3);

	// Reuse the same two worker realms for draft isolation, the contested Save
	// and reconnect. Only the parent authority can atomically admit the writer.
	const secondRequest = { requestId: randomUUID(), buildRequestId, sourceAccess: 'edit' };
	const second = (await call('studio_start_headless', secondRequest)).session.id;
	const draft = async (session: string, text: string) => {
		const source = await readEntry(session);
		assert.equal(source.source, original);
		const proposal = await call('studio_propose_edits', { toolContext: source.toolContext, title: 'Concurrent Studio Save',
			files: [{ receipt: source.receipt, edits: [{ offset: 0, deleteLength: 0, expectedText: '', text }] }] });
		const applied = await call('studio_resolve_review', { toolContext: source.toolContext, review: proposal.review, decision: 'apply' });
		assert.equal(applied.state, 'applied');
		const edited = await readEntry(session);
		assert.equal(edited.source, text + original);
		return edited;
	};
	const firstDraft = await draft(first, '-- first Studio\n');
	const secondDraft = await draft(second, '-- second Studio\n');
	const refused = await call('studio_close_headless', { session: first, discardUnsaved: false });
	assert.equal(refused.status, 'dirty');
	assert.equal(await readFile(savedPath, 'utf8'), original, 'applying a draft does not commit it');
	const drafts = [firstDraft, secondDraft];
	const contested = await Promise.all(drafts.map(({ toolContext, receipt }) => call('studio_save_source', { toolContext, receipt })));
	assert.deepEqual(contested.map(result => result.status).sort(), ['failed', 'saved']);
	const winner = contested.findIndex(result => result.status === 'saved');
	assert.equal(await readFile(savedPath, 'utf8'), drafts[winner].source);

	// MCP authority is per connection; acquired Studios and their drafts survive it.
	await current.transport.terminateSession(); await current.client.close(); connections.delete(current);
	current = await connect();
	assert.equal((await call('studio_list_sessions')).sessions.length, 2);
	await rejected('studio_runtime_status', { toolContext: firstSource.toolContext });
	for (const [index, workspace] of [request, secondRequest].entries()) {
		const session = index === 0 ? first : second;
		const retained = await readEntry(session);
		assert.equal(retained.source, drafts[index].source);
		const status = await call('studio_read_source_status', { toolContext: retained.toolContext, receipt: retained.receipt });
		assert.equal(status.dirty, index !== winner);
		assert.equal((await call('studio_close_headless', { session, discardUnsaved: index !== winner })).status, 'closed');
		await assert.rejects(access(mediaReference(session)), { code: 'ENOENT' });
		assert.equal((await call('studio_start_headless', workspace)).status, 'closed');
	}
	assert.deepEqual((await call('studio_list_sessions')).sessions, []);

	// A failed worker initialization must retire cleanly and must not register a
	// half-ready target. A later valid start uses a different immutable artifact.
	const artifact = await call('studio_read_artifact', { artifact: build.artifact });
	const cartRom = artifact.cart.outputs.find((output: { file: string }) => output.file.endsWith('.rom')).file;
	await rm(join(f.root, '.bmsx/builds/artifacts', artifact.id, cartRom));
	const failedRequest = { requestId: randomUUID(), buildRequestId, sourceAccess: 'edit' };
	await rejected('studio_start_headless', failedRequest);
	await rejected('studio_start_headless', failedRequest);
	assert.deepEqual((await call('studio_list_sessions')).sessions, []);
	await assert.rejects(access(f.trace));
});

test('user-owned proposal approval is independent of source-edit capability', async () => {
	let execution = 0, applications = 0, presented = 0;
	const proposal = { state: 'pending', reason: '', apply() { applications++; this.state = 'applied'; }, dispose() { this.state = 'discarded'; } };
	const requests = new StudioToolRequests({ open() { return { execute(name: string) {
		execution++;
		return name === 'studio_propose_edits' ? { kind: 'proposal', data: { review: 'source-review' }, proposal } : { kind: 'runtime', data: {} };
	} }; } } as unknown as WorkspaceToolService,
		{ sourceAccess: 'edit', reviewApproval: 'user', showReview() { presented++; } });
	try {
		await requests.execute('open', { type: 'open', context: 'frontend' });
		const history = await requests.execute('history', { type: 'call', context: 'frontend', name: 'studio_edit_history', arguments: {} });
		assert.equal(history!.success, true); assert.equal(execution, 1);
		await requests.execute('propose', { type: 'call', context: 'frontend', name: 'studio_propose_edits', arguments: {} });
		const apply = await requests.execute('apply', { type: 'resolve-review', context: 'frontend', review: 'source-review', decision: 'apply' });
		assert.equal(apply!.success, false); assert.equal(applications, 0); assert.equal(presented, 1); assert.equal(proposal.state, 'pending');
	} finally { requests.close(new Error('Test complete')); }
});
