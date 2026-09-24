import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resourceIdentityKey, type RuntimeResource } from '../../ide/common/resource';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { WorkspaceSourceTools } from '../../ide/workbench/services/assistant/source_tools';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords, readLocalWorkspaceRecord } from '../../ide/workspace/records';
import type { WorkspaceRecordProvider } from '../../ide/workspace/record_provider';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext) {
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1, 'return 1\n')]);
	const models = new EditorTextModelService(), storage = new MemoryStorage(), clock = new VirtualHeadlessClock();
	const f = createRuntimeInspectionFixture(createTestRuntime(createTestRuntimeRomPayload()), sources);
	const tooling = new RuntimeLuaTooling(sources, f.guest), diagnostics = new ResourceDiagnosticsService(models, tooling, clock);
	const saves = new TextFileSaveService(models, storage, clock, sources, tooling, f.runtime, f.tasks);
	const model = models.retain(sources.luaResources[0], 'lua', 'return 1\n');
	const yaml: RuntimeResource = { domain: 0, path: 'res/data/probe.yaml', source: { type: 'data', resid: 'probe' } };
	sources.resourceByIdentity.set(resourceIdentityKey(yaml), yaml);
	const data = models.retain(yaml, 'yaml', '# canonical 🐉\r\nvalue: 1\r\n');
	const tools = () => {
		const result = new WorkspaceSourceTools(models, sources, storage, diagnostics, new AbortController().signal,
			new BehaviorSourceDocuments(models, sources), saves);
		t.after(() => result.dispose()); return result;
	};
	const read = async (tools: WorkspaceSourceTools, path = 'cart.lua') => {
		const catalog = await tools.execute('studio_list_sources', {}); assert.equal(catalog.kind, 'sources');
		if (catalog.kind !== 'sources') assert.fail();
		const read = await tools.execute('studio_read_source', { resource: catalog.data.find(source => source.path === path)!.resource });
		if (read.kind !== 'source') assert.fail(); return read.data;
	};
	t.after(async () => { await saves.shutdown(); diagnostics.dispose(); f.presenter.dispose(); models.clear(); closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	return { ...f, models, storage, clock, saves, model, data, tools, read };
}

test('source Save uses the ordinary owner and reports local persistence separately from installation', async t => {
	const f = fixture(t);
	f.model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	f.data.pushEditOperations([{ offset: f.data.buffer.length, deleteLength: 0, text: '# added\r\n' }]);
	const tools = f.tools(), read = await f.read(tools), data = await f.read(tools, f.data.resource.path);
	const before = await tools.execute('studio_read_source_status', { receipt: read.receipt });
	assert.equal(before.kind, 'source-status');
	if (before.kind !== 'source-status') assert.fail();
	assert.equal(before.data.dirty, true); assert.equal(before.data.latestSave, undefined); assert.equal(before.data.runtime, 'source_only');
	const media = f.sources.currentBlua32Media, cycles = f.runtime.machine.scheduler.currentNowCycles();
	for (const receipt of [read, data]) {
		const saved = await tools.execute('studio_save_source', { receipt: receipt.receipt });
		if (saved.kind !== 'source-save' || saved.data.status !== 'saved') assert.fail();
		assert.equal(saved.data.version, receipt.version);
		assert.deepEqual(saved.data.persistence, { status: 'local-only', reason: 'disconnected' });
		assert.equal(saved.data.application.status, 'not-requested');
	}
	assert.equal(f.model.dirty, false); assert.equal(f.data.dirty, false);
	assert.equal(readLocalWorkspaceRecord(f.storage, 'carts/nemesis_s', 'carts/nemesis_s/res/data/probe.yaml')!.contents, data.source);
	assert.equal(f.runtime.machine.scheduler.currentNowCycles(), cycles); assert.equal(f.sources.currentBlua32Media, media);
	const status = await tools.execute('studio_read_source_status', { receipt: data.receipt });
	if (status.kind !== 'source-status') assert.fail();
	assert.equal(status.data.runtime, 'untracked'); assert.equal(status.data.latestSave!.matchesCurrentSource, true);
	assert.equal(status.data.latestSave!.operation, f.saves.latestOperation(f.data)!.id);
});

test('an accepted tool Save survives retirement and later typing; newer prompts inspect its historical acknowledgement', async t => {
	const f = fixture(t), write = Promise.withResolvers<void>();
	let delayed = false;
	const provider: WorkspaceRecordProvider = { async read() { return null; }, async readDirectory() { return []; }, async delete() {},
		async write() { if (delayed) await write.promise; } };
	await openWorkspaceRecords(f.storage, f.clock, 'carts/nemesis_s', provider);
	delayed = true;
	t.after(() => write.resolve());
	f.model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	const tools = f.tools(), read = await f.read(tools), signal = new AbortController();
	const saving = tools.execute('studio_save_source', { receipt: read.receipt }, signal.signal), operation = f.saves.latestOperation(f.model)!;
	assert.equal(f.saves.save(f.model), operation, 'ordinary and tool Saves coalesce through one owner');
	const pending = await tools.execute('studio_read_source_status', { receipt: read.receipt });
	if (pending.kind !== 'source-status') assert.fail();
	assert.equal(pending.data.latestSave!.result.status, 'pending');
	f.model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '3' }]);
	signal.abort(); tools.dispose(); write.resolve();
	const result = await saving;
	if (result.kind !== 'source-save' || result.data.status !== 'saved') assert.fail();
	assert.equal(result.data.version, read.version); assert.deepEqual(result.data.persistence, { status: 'workspace' });
	assert.equal(f.model.lastSavedSource, read.source); assert.equal(f.model.dirty, true);
	const next = f.tools(), current = await f.read(next), status = await next.execute('studio_read_source_status', { receipt: current.receipt });
	if (status.kind !== 'source-status') assert.fail();
	assert.equal(status.data.latestSave!.operation, operation.id); assert.equal(status.data.latestSave!.matchesCurrentSource, false);
	assert.equal(status.data.latestSave!.result.status, 'saved');
	await assert.rejects(next.execute('studio_save_source', { receipt: read.receipt }), /receipt read/);
	const latest = f.saves.save(f.model); await latest.completion;
	assert.notEqual(latest.id, operation.id); assert.equal(latest.result!.snapshot.source, current.source);
});

test('Save rejects unread, expired, read-only and cancelled authority before IO; it cannot approve a proposal', async t => {
	const f = fixture(t), tools = f.tools(), read = await f.read(tools);
	await assert.rejects(tools.execute('studio_save_source', { receipt: 'foreign' }), /receipt read/);
	await assert.rejects(tools.execute('studio_save_source', { receipt: read.receipt, apply: true }));
	await assert.rejects(tools.execute('studio_save_source', { receipt: read.receipt }, AbortSignal.abort()), { name: 'AbortError' });
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	await assert.rejects(tools.execute('studio_save_source', { receipt: read.receipt }), /read-only/);
	assert.equal(f.saves.latestOperation(f.model), undefined);
	f.model.refreshResource(f.sources.luaResources[0]);
	const proposal = await tools.execute('studio_propose_edits', { title: 'Review', files: [{ receipt: read.receipt,
		edits: [{ offset: 7, deleteLength: 1, expectedText: '1', text: '2' }] }] });
	if (proposal.kind !== 'proposal') assert.fail();
	await assert.rejects(tools.execute('studio_save_source', { receipt: read.receipt }), /proposed/);
	proposal.proposal.apply();
	const next = f.tools(), current = await f.read(next);
	f.model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '3' }]);
	await assert.rejects(next.execute('studio_save_source', { receipt: current.receipt }), /Source changed/);
	assert.equal(f.saves.latestOperation(f.model), undefined);
});

test('project write failure and AEM build failure remain distinct textual wire outcomes', async t => {
	const f = fixture(t);
	let rejectWrite = false;
	await openWorkspaceRecords(f.storage, f.clock, 'carts/nemesis_s', {
		async read() { return null; }, async readDirectory() { return []; }, async delete() {},
		async write() { if (rejectWrite) throw new Error('provider refused write'); },
	});
	rejectWrite = true;
	const resource: RuntimeResource = { domain: 0, path: 'res/probe.aem.yaml', source: { type: 'aem', resid: 'probe' } };
	f.sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	f.models.retain(resource, 'aem', 'not: [valid');
	const tools = f.tools(), read = await f.read(tools, resource.path);
	const result = await tools.execute('studio_save_source', { receipt: read.receipt });
	if (result.kind !== 'source-save' || result.data.status !== 'saved') assert.fail();
	assert.deepEqual(result.data.persistence, { status: 'local-only', reason: 'write-failed', error: 'Error: provider refused write' });
	assert.equal(result.data.application.status, 'failed');
	if (result.data.application.status !== 'failed') assert.fail();
	assert.equal(result.data.application.phase, 'build'); assert.match(result.data.application.error, /flow collection/);
	assert.equal(f.tasks.failure, undefined);
});

test('late Save completion cannot replace the acknowledgement of a newer accepted Save', async t => {
	const f = fixture(t), gates: (() => void)[] = [];
	let delayed = false;
	await openWorkspaceRecords(f.storage, f.clock, 'carts/nemesis_s', {
		async read() { return null; }, async readDirectory() { return []; }, async delete() {},
		async write() { if (delayed) await new Promise<void>(resolve => gates.push(resolve)); },
	});
	delayed = true;
	const old = f.saves.save(f.model);
	f.model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	const current = f.saves.save(f.model);
	await setImmediate(); gates.shift()!(); await old.completion;
	assert.equal(old.result!.status, 'saved'); assert.equal(f.saves.latestOperation(f.model), current); assert.equal(current.result, undefined);
	await setImmediate(); gates.shift()!(); await current.completion;
	assert.equal(current.result!.snapshot.source, 'return 2\n'); assert.equal(f.model.dirty, false);
});

test('failed local persistence remains a failed Save with dirty source and an inspectable error', async t => {
	const f = fixture(t);
	f.model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	f.storage.setItem = () => { throw new Error('local storage denied'); };
	const tools = f.tools(), read = await f.read(tools);
	const result = await tools.execute('studio_save_source', { receipt: read.receipt });
	if (result.kind !== 'source-save') assert.fail();
	assert.deepEqual(result.data, { receipt: read.receipt, operation: f.saves.latestOperation(f.model)!.id,
		status: 'failed', version: read.version, error: 'Error: local storage denied' });
	assert.equal(f.model.dirty, true); assert.equal(f.model.lastSavedSource, 'return 1\n');
	const status = await tools.execute('studio_read_source_status', { receipt: read.receipt });
	if (status.kind !== 'source-status') assert.fail();
	assert.equal(status.data.latestSave!.result.status, 'failed');
});
