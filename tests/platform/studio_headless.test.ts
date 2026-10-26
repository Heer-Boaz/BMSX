import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, readdir, readFile, rm } from 'node:fs/promises';
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

test('an archived artifact without source admission cannot open an authoring Studio or read media', async t => {
	let reads = 0;
	const sessions = new StudioSessions({
		subscribe() { return () => {}; },
		get() { return { state: 'completed', artifact: 'archived-artifact' }; },
		artifacts: { async read() { reads++; throw new Error('Media must not be read before source admission'); } },
	} as unknown as StudioBuildJobs);
	t.after(() => sessions.close());
	await assert.rejects(sessions.startHeadless({ requestId: randomUUID(), buildRequestId: randomUUID(), sourceAccess: 'review' }));
	assert.equal(reads, 0);
	assert.equal(sessions.list().length, 0);
});

test('headless Studio owns runtime, source history, persistence and session lifetime without a browser', { timeout: 180000 }, async t => {
	type Connection = { client: Client; transport: StreamableHTTPClientTransport };
	const connections = new Set<Connection>();
	t.after(async () => {
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
		const entry = catalog.find((resource: { domain: number; path: string }) => resource.domain === 0 && resource.path === 'entry.lua');
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
	assert.equal(started.session.kind, 'headless'); assert.equal(started.session.sourceAccess, 'edit');
	assert.equal(started.session.reviewApproval, 'agent');
	assert.equal((await call('studio_list_sessions')).sessions.length, 1);
	await rejected('studio_start_headless', { ...request, sourceAccess: 'review' });
	await rejected('studio_start_headless', { requestId: randomUUID(), buildRequestId: randomUUID(), sourceAccess: 'edit' });
	assert.equal((await call('studio_list_sessions')).sessions.length, 1);
	let firstSource = await readEntry(first);
	assert.equal(firstSource.source, original);
	let runtime = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	while (runtime.operationActive || runtime.activeCartridge < 0 || !runtime.history.canStepForward) {
		await delay(25);
		runtime = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	}
	assert.equal(runtime.fault, undefined);
	await call('studio_pause_runtime', { toolContext: firstSource.toolContext, target: runtime.target });
	const evaluation = await call('studio_evaluate_lua', { toolContext: firstSource.toolContext, target: runtime.target, context: 'cart', source: 'return 6 * 7' });
	assert.equal(evaluation.status, 'completed'); assert.deepEqual(evaluation.values, ['42']);
	const stepped = await call('studio_step_frames', { toolContext: firstSource.toolContext, target: runtime.target, direction: 'forward', count: 3 });
	assert.equal(stepped.status, 'completed'); assert.equal(stepped.after.videoTick - stepped.before.videoTick, 3);
	const recorded = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	await rejected('studio_finish_history_review', { toolContext: firstSource.toolContext, target: runtime.target, destination: 'here' });
	const rewound = await call('studio_step_frames', { toolContext: firstSource.toolContext, target: runtime.target, direction: 'backward', count: 1 });
	assert.equal(rewound.status, 'completed'); assert.ok(rewound.after.videoTick < rewound.before.videoTick);
	await rejected('studio_finish_history_review', { toolContext: firstSource.toolContext, target: 'wrong-target', destination: 'present' });
	await rejected('studio_finish_history_review', { toolContext: firstSource.toolContext, target: runtime.target, destination: 'latest' });
	const present = await call('studio_finish_history_review', { toolContext: firstSource.toolContext, target: runtime.target, destination: 'present' });
	assert.equal(present.target, runtime.target); assert.equal(present.status, 'completed');
	assert.deepEqual(present.request, { kind: 'finish-review', destination: 'present' });
	assert.deepEqual(present.before, rewound.after); assert.deepEqual(present.after, stepped.after);
	assert.equal(present.completedFrames, 0);
	assert.deepEqual(present.history, { reviewing: false, earliestCycles: recorded.history.earliestCycles, latestCycles: recorded.history.latestCycles });
	const atPresent = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	assert.equal(atPresent.userPaused, true); assert.equal(atPresent.paused, true); assert.equal(atPresent.operationActive, false);
	assert.deepEqual({ cycles: atPresent.cycles, videoTick: atPresent.videoTick }, stepped.after);
	assert.equal(atPresent.history.reviewing, false); assert.equal(atPresent.history.latestCycles, recorded.history.latestCycles);
	assert.equal(atPresent.debugger.canContinue, true, 'returning to present enables Continue without executing a live frame');
	const reviewed = await call('studio_step_frames', { toolContext: firstSource.toolContext, target: runtime.target, direction: 'backward', count: 1 });
	assert.equal(reviewed.status, 'completed'); assert.deepEqual(reviewed.after, rewound.after);
	const here = await call('studio_finish_history_review', { toolContext: firstSource.toolContext, target: runtime.target, destination: 'here' });
	assert.equal(here.target, runtime.target); assert.equal(here.status, 'completed');
	assert.deepEqual(here.request, { kind: 'finish-review', destination: 'here' });
	assert.deepEqual(here.before, reviewed.after); assert.deepEqual(here.after, reviewed.after);
	assert.equal(here.completedFrames, 0);
	assert.deepEqual(here.history, { reviewing: false, earliestCycles: recorded.history.earliestCycles, latestCycles: reviewed.after.cycles });
	const atBranch = await call('studio_runtime_status', { toolContext: firstSource.toolContext });
	assert.equal(atBranch.userPaused, true); assert.equal(atBranch.paused, true); assert.equal(atBranch.operationActive, false);
	assert.deepEqual({ cycles: atBranch.cycles, videoTick: atBranch.videoTick }, reviewed.after);
	assert.equal(atBranch.history.reviewing, false); assert.equal(atBranch.history.latestCycles, reviewed.after.cycles);
	assert.ok(atBranch.history.latestCycles < recorded.history.latestCycles, 'accepting the reviewed point truncates the recorded future');
	assert.equal(atBranch.debugger.canContinue, true, 'accepting the reviewed point enables Continue without executing a live frame');
	await rejected('studio_finish_history_review', { toolContext: firstSource.toolContext, target: runtime.target, destination: 'present' });
	const capture = await current.client.callTool({ name: 'studio_capture_game', arguments: { toolContext: firstSource.toolContext, target: runtime.target } }) as CallToolResult;
	assert.notEqual(capture.isError, true); assert.ok(capture.content.some(block => block.type === 'image'));

	const readOnly = await call('studio_start_headless', { requestId: randomUUID(), buildRequestId, sourceAccess: 'review' });
	const readOnlySource = await readEntry(readOnly.session.id);
	const readOnlyProposal = await call('studio_propose_edits', { toolContext: readOnlySource.toolContext, title: 'Read-only proposal',
		files: [{ receipt: readOnlySource.receipt, edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: '-- unapproved\n' }] }] });
	await rejected('studio_resolve_review', { toolContext: readOnlySource.toolContext, review: readOnlyProposal.review, decision: 'apply' });
	const freshReadOnly = await readEntry(readOnly.session.id);
	await rejected('studio_save_source', { toolContext: freshReadOnly.toolContext, receipt: freshReadOnly.receipt });
	await rejected('studio_edit_history', { toolContext: freshReadOnly.toolContext, receipt: freshReadOnly.receipt, direction: 'undo' });
	assert.equal((await call('studio_read_review', { toolContext: readOnlySource.toolContext, review: readOnlyProposal.review })).state, 'pending');
	assert.equal((await call('studio_close_headless', { session: readOnly.session.id, discardUnsaved: false })).status, 'closed');
	assert.equal(await readFile(savedPath, 'utf8'), original);

	const secondRequest = { requestId: randomUUID(), buildRequestId, sourceAccess: 'edit' };
	const second = (await call('studio_start_headless', secondRequest)).session.id;
	const secondSource = await readEntry(second);
	firstSource = await readEntry(first);
	const firstText = '-- first Studio draft\n';
	const proposal = await call('studio_propose_edits', { toolContext: firstSource.toolContext, title: 'First Studio draft',
		files: [{ receipt: firstSource.receipt, edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: firstText }] }] });
	assert.equal((await call('studio_resolve_review', { toolContext: firstSource.toolContext, review: proposal.review, decision: 'apply' })).state, 'applied');
	assert.equal((await readEntry(second)).source, original);
	const secondText = '-- second Studio draft\n';
	const secondProposal = await call('studio_propose_edits', { toolContext: secondSource.toolContext, title: 'Second Studio draft',
		files: [{ receipt: secondSource.receipt, edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: secondText }] }] });
	await call('studio_resolve_review', { toolContext: secondSource.toolContext, review: secondProposal.review, decision: 'apply' });
	await delay(2600); // The ordinary debounced recovery owner, not a test-only flush.
	for (const [identity, contents] of [[request.requestId, firstText + original], [secondRequest.requestId, secondText + original]]) {
		const directory = join(f.root, build.project.cartridge.projectRoot, '.bmsx/studio', build.project.cartridge.id, identity);
		const recovery = JSON.parse(await readFile(join(directory, 'sources.json'), 'utf8'));
		const entry = recovery.dirtyFiles.find((entry: { domain: number; path: string }) => entry.domain === 0 && entry.path === 'entry.lua');
		assert.ok(entry);
		const files = await readdir(directory, { recursive: true });
		const sourcePath = files.find(path => path.endsWith(`~entry.lua.${entry.updatedAt}`))!;
		assert.equal(await readFile(join(directory, sourcePath), 'utf8'), contents);
	}
	const dirty = await call('studio_close_headless', { session: first, discardUnsaved: false });
	assert.equal(dirty.status, 'dirty'); assert.ok(dirty.resources.some((resource: { domain: number; path: string }) => resource.domain === 0 && resource.path === 'entry.lua'));
	assert.equal(await readFile(savedPath, 'utf8'), original);
	let edited = await readEntry(first);
	assert.equal(edited.source, firstText + original);
	await call('studio_edit_history', { toolContext: edited.toolContext, receipt: edited.receipt, direction: 'undo' });
	edited = await readEntry(first); assert.equal(edited.source, original);
	await call('studio_edit_history', { toolContext: edited.toolContext, receipt: edited.receipt, direction: 'redo' });
	edited = await readEntry(first); assert.equal(edited.source, firstText + original);
	const saved = await call('studio_save_source', { toolContext: edited.toolContext, receipt: edited.receipt });
	assert.equal(saved.status, 'saved'); assert.equal(saved.persistence.status, 'workspace');
	assert.equal(await readFile(savedPath, 'utf8'), firstText + original);
	const reboot = await call('studio_reboot_runtime', { toolContext: edited.toolContext, target: runtime.target });
	assert.equal(reboot.result.status, 'reset'); assert.equal(reboot.result.installed, true); assert.equal(reboot.result.reset, true);
	assert.ok(reboot.capturedDocuments.some((document: { domain: number; path: string; version: number }) =>
		document.domain === 0 && document.path === 'entry.lua' && document.version === edited.version));
	const installed = await readEntry(first);
	assert.equal((await call('studio_read_source_status', { toolContext: installed.toolContext, receipt: installed.receipt })).runtime, 'applied');
	const afterInstall = await call('studio_step_frames', { toolContext: installed.toolContext, target: runtime.target, direction: 'forward', count: 3 });
	assert.equal(afterInstall.status, 'completed'); assert.equal(afterInstall.after.videoTick - afterInstall.before.videoTick, 3);

	// The other workspace still owns its original captured bytes. Its later Save must
	// not overwrite a canonical revision committed by a different Studio.
	const secondDraft = await readEntry(second);
	const staleSave = await call('studio_save_source', { toolContext: secondDraft.toolContext, receipt: secondDraft.receipt });
	assert.equal(staleSave.status, 'failed');
	assert.equal(await readFile(savedPath, 'utf8'), firstText + original);
	const retained = await readEntry(second);
	assert.equal(retained.source, secondText + original);
	assert.equal((await call('studio_read_source_status', { toolContext: retained.toolContext, receipt: retained.receipt })).dirty, true);

	// MCP authority is per connection, physical Studio lifetime is not.
	const oldContext = edited.toolContext;
	await current.transport.terminateSession(); await current.client.close(); connections.delete(current);
	current = await connect();
	assert.equal((await call('studio_list_sessions')).sessions.length, 2);
	await rejected('studio_runtime_status', { toolContext: oldContext });
	assert.equal((await readEntry(first)).source, firstText + original);
	assert.equal((await readEntry(second)).source, secondText + original);
	assert.equal((await call('studio_close_headless', { session: second, discardUnsaved: true })).status, 'closed');
	assert.equal((await call('studio_start_headless', secondRequest)).status, 'closed');
	assert.equal((await call('studio_close_headless', { session: first, discardUnsaved: false })).status, 'closed');
	assert.equal((await call('studio_start_headless', request)).status, 'closed');
	assert.deepEqual((await call('studio_list_sessions')).sessions, []);

	// Two worker realms must arbitrate canonical writes in the SAME parent-owned
	// queue. Merely checking expected bytes in each worker is not atomic.
	const concurrent = await Promise.all(['-- concurrent A\n', '-- concurrent B\n'].map(async text => {
		const start = await call('studio_start_headless', { requestId: randomUUID(), buildRequestId, sourceAccess: 'edit' });
		const source = await readEntry(start.session.id);
		assert.equal(source.source, firstText + original);
		const proposal = await call('studio_propose_edits', { toolContext: source.toolContext, title: 'Concurrent Studio Save',
			files: [{ receipt: source.receipt, edits: [{ offset: 0, deleteLength: 0, expectedText: '', text }] }] });
		await call('studio_resolve_review', { toolContext: source.toolContext, review: proposal.review, decision: 'apply' });
		return { session: start.session.id, source: await readEntry(start.session.id), expected: text + source.source };
	}));
	const contested = await Promise.all(concurrent.map(({ source }) => call('studio_save_source', {
		toolContext: source.toolContext, receipt: source.receipt,
	})));
	assert.deepEqual(contested.map(result => result.status).sort(), ['failed', 'saved']);
	const winner = contested.findIndex(result => result.status === 'saved');
	assert.equal(await readFile(savedPath, 'utf8'), concurrent[winner].expected);
	for (const workspace of concurrent) {
		assert.equal((await readEntry(workspace.session)).source, workspace.expected);
		assert.equal((await call('studio_close_headless', { session: workspace.session, discardUnsaved: true })).status, 'closed');
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
