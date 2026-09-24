import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { resourceIdentityKey, type RuntimeResource } from '../../ide/common/resource';
import { WorkspaceSourceTools } from '../../ide/workbench/services/assistant/source_tools';
import { StudioToolInputError } from '../../ide/workbench/services/assistant/tool_input';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { workspaceCanonicalSourceCache } from '../../ide/workspace/cache';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

function fixture(t: TestContext) {
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1, 'return old -- saved\n')]);
	const models = new EditorTextModelService(), connection = new AbortController();
	const storage = { getItem: () => null, setItem: () => assert.fail('Tools must not save'), removeItem: () => assert.fail('Tools must not delete') };
	const yaml: RuntimeResource = { domain: 0, path: 'res/data/stage.yaml', source: { type: 'data', resid: 'stage' } };
	const binary: RuntimeResource = { domain: 0, path: 'art.png', source: { type: 'image', resid: 'art' } };
	sources.resourceByIdentity.set(resourceIdentityKey(yaml), yaml); sources.resourceByIdentity.set(resourceIdentityKey(binary), binary);
	const yamlPath = 'carts/nemesis_s/res/data/stage.yaml';
	const yamlSource = '# exact 🐉\r\nvalue: old\r\n';
	workspaceCanonicalSourceCache.set(yamlPath, yamlSource);
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	const { tasks, presenter } = createRuntimeInspectionFixture(runtime, sources, tooling.suspendedGuest);
	const diagnostics = new ResourceDiagnosticsService(models, tooling, new VirtualHeadlessClock());
	const saves = new TextFileSaveService(models, storage, new VirtualHeadlessClock(), sources, tooling, runtime, tasks);
	const tools = new WorkspaceSourceTools(models, sources, storage, diagnostics, connection.signal, new BehaviorSourceDocuments(models, sources), saves);
	t.after(async () => { tools.dispose(); connection.abort(); await saves.shutdown(); presenter.dispose(); diagnostics.dispose(); models.clear(); workspaceCanonicalSourceCache.delete(yamlPath); });
	const list = async () => {
		const result = await tools.execute('studio_list_sources', {});
		assert.ok(result.kind === 'sources'); return result.data;
	};
	const read = async (path: string) => {
		const resource = (await list()).find(resource => resource.path === path)!;
		const result = await tools.execute('studio_read_source', { resource: resource.resource });
		assert.ok(result.kind === 'source'); return result.data;
	};
	return { models, sources, connection, storage, diagnostics, saves, tools, yaml, yamlSource, list, read };
}

test('source tools resolve unopened authored Lua/YAML into the supplied owner, never global models or cooked data', async t => {
	const f = fixture(t);
	assert.equal([...f.models.models].length, 0);
	const catalog = await f.list();
	assert.deepEqual(catalog.map(source => source.path), ['cart.lua', 'res/data/stage.yaml']);
	assert.equal([...f.models.models].length, 0, 'listing does not read files or create tabs/models');
	const [a, b] = await Promise.all([f.read('res/data/stage.yaml'), f.read('res/data/stage.yaml')]);
	assert.equal(a, b, 'concurrent reads coalesce to the identical source receipt');
	assert.equal(a.source, f.yamlSource);
	assert.equal(f.models.get(f.yaml)!.canUndo, false);
	assert.equal(editorTextModelService.get(f.yaml), undefined);
	assert.equal((await f.read('cart.lua')).source, 'return old -- saved\n');
	assert.equal(f.models.get({ domain: 0, path: 'cart.lua' })!.dirty, false);
});

test('tools read unsaved working copies and propose exact multi-file review without applying, saving or breaking typing history', async t => {
	const f = fixture(t);
	f.tools.dispose();
	const lua = f.models.retain(f.sources.luaResources[0], 'lua', 'return old -- saved\n');
	lua.pushEditOperations([{ offset: 7, deleteLength: 3, text: 'unsaved' }]);
	const tools = new WorkspaceSourceTools(f.models, f.sources, f.storage, f.diagnostics, f.connection.signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves); t.after(() => tools.dispose());
	const catalog = await tools.execute('studio_list_sources', {}); assert.ok(catalog.kind === 'sources');
	const reads = await Promise.all(catalog.data.map(resource => tools.execute('studio_read_source', { resource: resource.resource })));
	assert.ok(reads[0].kind === 'source'); assert.ok(reads[1].kind === 'source');
	assert.equal(reads[0].data.source, 'return unsaved -- saved\n');
	const proposed = await tools.execute('studio_propose_edits', { title: 'Source tool review', files: [
		{ receipt: reads[0].data.receipt, edits: [{ offset: 7, deleteLength: 7, expectedText: 'unsaved', text: 'new' }] },
		{ receipt: reads[1].data.receipt, edits: [{ offset: f.yamlSource.indexOf('old'), deleteLength: 3, expectedText: 'old', text: 'new' }] },
	] });
	assert.ok(proposed.kind === 'proposal');
	const input = new WorkspaceEditReviewInput(proposed.proposal); t.after(() => input.dispose());
	assert.deepEqual(proposed.data, { status: 'review-required', review: proposed.data.review, files: 2 });
	assert.match(proposed.data.review, /\/review$/);
	assert.notEqual(proposed.data.review, reads[0].data.receipt, 'observing a review does not grant source rights');
	assert.equal(lua.buffer.getText(), 'return unsaved -- saved\n');
	assert.equal(f.models.get(f.yaml)!.dirty, false);
	assert.equal(proposed.proposal.state, 'pending');
	assert.equal(catalog.data.length, 2, 'previous catalog results remain immutable after context transfer');
	tools.dispose();
	assert.equal(proposed.proposal.state, 'pending', 'turn completion does not discard its transferred review');
	proposed.proposal.apply();
	assert.equal(lua.buffer.getText(), 'return new -- saved\n');
	assert.equal(f.models.get(f.yaml)!.buffer.getText(), f.yamlSource.replace('old', 'new'));
	assert.equal(lua.lastSavedSource, 'return old -- saved\n');
	f.models.get(f.yaml)!.undo();
	assert.equal(lua.buffer.getText(), 'return unsaved -- saved\n');
	assert.equal(f.models.get(f.yaml)!.buffer.getText(), f.yamlSource);
	lua.redo(); assert.equal(lua.buffer.getText(), 'return new -- saved\n');
	assert.equal(getEventListeners(f.connection.signal, 'abort').length, 0, 'terminal proposals release their connection subscription');
	await assert.rejects(tools.execute('studio_read_source', { resource: catalog.data[0].resource }), /proposed/);
});

test('connection closure retires a transferred pending review, not its shared working copies', async t => {
	const f = fixture(t), read = await f.read('cart.lua');
	const result = await f.tools.execute('studio_propose_edits', { title: 'Disconnect probe', files: [{ receipt: read.receipt,
		edits: [{ offset: 7, deleteLength: 3, text: 'new', expectedText: 'old' }] }] });
	assert.ok(result.kind === 'proposal');
	f.tools.dispose();
	assert.equal(result.proposal.state, 'pending');
	f.connection.abort();
	assert.equal(result.proposal.state, 'stale');
	assert.throws(() => result.proposal.apply(), /stale/);
	assert.equal(f.models.get({ domain: 0, path: 'cart.lua' })!.canUndo, false);
	assert.equal(getEventListeners(f.connection.signal, 'abort').length, 0);
});

test('source changes retire the original prompt context even before its first read, and rereading cannot refresh it', async t => {
	const f = fixture(t);
	const lua = f.models.retain(f.sources.luaResources[0], 'lua', 'return old');
	lua.pushEditOperations([{ offset: 7, deleteLength: 3, text: 'new' }]);
	await assert.rejects(f.list(), /Source changed/);
	lua.undo();
	await assert.rejects(f.list(), /Source changed/);
});

test('resource handles and read receipts from another connection/context cannot retarget matching paths and versions', async t => {
	const f = fixture(t), first = await f.read('cart.lua'), catalog = await f.list();
	const other = new WorkspaceSourceTools(f.models, f.sources, f.storage, f.diagnostics, new AbortController().signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves); t.after(() => other.dispose());
	await assert.rejects(other.execute('studio_read_source', { resource: catalog[0].resource }), /does not belong/);
	await assert.rejects(other.execute('studio_read_source', { resource: '../../etc/passwd' }), /does not belong/);
	await assert.rejects(other.execute('studio_propose_edits', { title: 'Old rights', files: [{ receipt: first.receipt,
		edits: [{ offset: 0, deleteLength: 0, text: 'no', expectedText: '' }] }] }), /needs a receipt/);
});

test('YAML admission delayed past teardown cannot capture a model from a replacement workspace', async t => {
	const f = fixture(t);
	let resolve!: (source: string) => void;
	const pending = f.models.resolve(f.yaml, 'yaml', () => new Promise(done => { resolve = done; }));
	const resource = (await f.list()).find(source => source.path === f.yaml.path)!;
	const reading = f.tools.execute('studio_read_source', { resource: resource.resource });
	f.models.clear();
	resolve(f.yamlSource);
	await assert.rejects(reading, /workspace teardown/);
	await assert.rejects(pending, /workspace teardown/);
	assert.equal(f.models.get(f.yaml), undefined);
});

test('data catalog replacement invalidates a pending review even when Lua registry identities are unchanged', async t => {
	const f = fixture(t), source = await f.read('res/data/stage.yaml');
	const result = await f.tools.execute('studio_propose_edits', { title: 'Catalog probe', files: [{ receipt: source.receipt,
		edits: [{ offset: f.yamlSource.indexOf('old'), deleteLength: 3, expectedText: 'old', text: 'new' }] }] });
	assert.ok(result.kind === 'proposal');
	f.sources.resourceByIdentity = new Map(f.sources.resourceByIdentity);
	assert.throws(() => result.proposal.apply(), /resource catalog was replaced/);
	assert.equal(result.proposal.state, 'stale');
	assert.equal(f.models.get(f.yaml)!.canUndo, false);
});

test('external malformed, unproven or ambiguous edits reject the whole proposal without mutating history', async t => {
	const f = fixture(t), source = await f.read('cart.lua');
	const edit = { offset: 7, deleteLength: 3, text: 'new', expectedText: 'old' };
	const file = { receipt: source.receipt, edits: [edit] };
	for (const files of [
		[{ ...file, receipt: 'unread' }], [file, file],
		[{ ...file, edits: [{ ...edit, expectedText: 'not old' }] }],
		[{ ...file, edits: [{ ...edit, offset: 999 }] }],
		[{ ...file, edits: [{ ...edit, deleteLength: 999 }] }],
		[{ ...file, edits: [edit, { ...edit, offset: 6 }] }],
		[{ ...file, edits: [edit, { ...edit, offset: 8 }] }],
		[{ ...file, edits: [{ ...edit, offset: 0.5 }] }],
		[{ ...file, edits: [{ ...edit, offset: '7' }] }],
		[{ ...file, edits: [{ ...edit, deleteLength: -1 }] }],
		[{ ...file, edits: [{ ...edit, text: null }] }],
		[{ ...file, edits: [] }], [], null,
	]) await assert.rejects(f.tools.execute('studio_propose_edits', { title: 'Invalid', files }), StudioToolInputError);
	await assert.rejects(f.tools.execute('studio_list_sources', { cwd: '/tmp' }), StudioToolInputError);
	await assert.rejects(f.tools.execute('studio_propose_edits', { title: 'Cannot apply', files: [file], apply: true }), StudioToolInputError);
	await assert.rejects(f.tools.execute('apply_patch', {}), StudioToolInputError);
	assert.equal(f.models.get({ domain: 0, path: 'cart.lua' })!.canUndo, false);
});

test('read-only rights are checked for all proposal participants before any write', async t => {
	const f = fixture(t), lua = await f.read('cart.lua'), yaml = await f.read('res/data/stage.yaml');
	f.models.get(f.yaml)!.refreshResource({ ...f.yaml, source: { ...f.yaml.source, generated: true } });
	await assert.rejects(f.tools.execute('studio_propose_edits', { title: 'Read-only', files: [
		{ receipt: lua.receipt, edits: [{ offset: 7, deleteLength: 3, text: 'new', expectedText: 'old' }] },
		{ receipt: yaml.receipt, edits: [{ offset: 0, deleteLength: 0, text: '# new\n', expectedText: '' }] },
	] }), /read-only/);
	assert.equal(f.models.get({ domain: 0, path: 'cart.lua' })!.canUndo, false);
	assert.equal(f.models.get(f.yaml)!.canUndo, false);
});

test('text source resolution consumes its explicit model owner and coalesces ordinary callers too', async t => {
	const f = fixture(t);
	const a = await resolveTextFileModel(f.models, f.storage, f.sources, f.yaml);
	const b = await resolveTextFileModel(f.models, f.storage, f.sources, f.yaml);
	assert.equal(a, b); assert.equal(f.models.get(f.yaml), a);
	assert.equal(editorTextModelService.get(f.yaml), undefined);
});

test('diagnostic receipts preserve exact unsaved source coordinates and reuse the ordinary resource results', async t => {
	const f = fixture(t);
	const lua = f.models.retain(f.sources.luaResources[0], 'lua', 'return old -- saved\n');
	const prefix = "local before = '🐉'; return ";
	lua.pushEditOperations([{ offset: 0, deleteLength: lua.buffer.length, text: `-- 🐉\r\n${prefix}missing_after_unicode\r\n` }]);
	f.tools.dispose();
	const tools = new WorkspaceSourceTools(f.models, f.sources, f.storage, f.diagnostics, f.connection.signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves); t.after(() => tools.dispose());
	const catalog = await tools.execute('studio_list_sources', {}); assert.ok(catalog.kind === 'sources');
	const read = await tools.execute('studio_read_source', { resource: catalog.data[0].resource }); assert.ok(read.kind === 'source');
	const result = await tools.execute('studio_read_diagnostics', { receipt: read.data.receipt }); assert.ok(result.kind === 'diagnostics');
	assert.equal(result.data.receipt, read.data.receipt); assert.equal(result.data.version, read.data.version);
	assert.ok(result.data.status === 'ready');
	const marker = result.data.diagnostics.find(diagnostic => diagnostic.message.includes('missing_after_unicode'))!;
	assert.equal(marker.row, 1); assert.equal(marker.startColumn, prefix.length);
	assert.equal(marker.endColumn, prefix.length + 'missing_after_unicode'.length);
	const shared = f.diagnostics.get(lua.identity)!; assert.ok(shared.status === 'ready');
	assert.deepEqual(result.data.diagnostics, shared.diagnostics.map(({ model: _model, version: _version, ...marker }) => marker));
	const parser = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	const text = t.mock.method(lua.buffer, 'getText');
	let publications = 0; f.diagnostics.onDidChange(() => publications++);
	for (let read = 0; read < 1000; read++) {
		const again = await tools.execute('studio_read_diagnostics', { receipt: result.data.receipt });
		assert.equal(again.data, result.data, 'unchanged diagnostic transport projection is retained');
	}
	assert.equal(parser.mock.callCount(), 0); assert.equal(text.mock.callCount(), 0); assert.equal(publications, 0);
	assert.equal(lua.lastSavedSource, 'return old -- saved\n');
	assert.equal(editorTextModelService.get(lua.identity), undefined);
});

test('unrequested, unsupported and ready-empty diagnostic coverage are distinct', async t => {
	const f = fixture(t);
	await f.list();
	assert.equal(f.diagnostics.get(f.sources.luaResources[0]), undefined, 'listing never analyzes or claims clean unopened resources');
	f.models.retain(f.sources.luaResources[0], 'lua', 'return 1');
	const lua = await f.read('cart.lua'), yaml = await f.read('res/data/stage.yaml');
	const ready = await f.tools.execute('studio_read_diagnostics', { receipt: lua.receipt });
	assert.deepEqual(ready.data, { receipt: lua.receipt, version: lua.version, status: 'ready', diagnostics: [] });
	const unsupported = await f.tools.execute('studio_read_diagnostics', { receipt: yaml.receipt });
	assert.deepEqual(unsupported.data, { receipt: yaml.receipt, version: yaml.version, status: 'unsupported' });
});

test('diagnostic provider failure stays explicit and repeated tool reads do not retry unchanged analysis', async t => {
	const f = fixture(t), read = await f.read('cart.lua');
	const compute = t.mock.method(getOrCreateSemanticProject(f.models, 0), 'getSnapshot', () => { throw new Error('diagnostic fixture failure'); });
	const result = await f.tools.execute('studio_read_diagnostics', { receipt: read.receipt });
	assert.deepEqual(result.data, { receipt: read.receipt, version: read.version, status: 'failed', error: 'Error: diagnostic fixture failure' });
	assert.equal((await f.tools.execute('studio_read_diagnostics', { receipt: read.receipt })).data, result.data);
	assert.equal(compute.mock.callCount(), 1);
});

test('diagnostics reject external malformed, unread and foreign receipts before analysis', async t => {
	const f = fixture(t), read = await f.read('cart.lua');
	const compute = t.mock.method(f.diagnostics, 'computePending');
	for (const input of [{}, { receipt: 0 }, { receipt: read.receipt, path: 'cart.lua' }, { receipt: 'cart.lua' }, { receipt: read.resource }]) {
		await assert.rejects(f.tools.execute('studio_read_diagnostics', input), StudioToolInputError);
	}
	const other = new WorkspaceSourceTools(f.models, f.sources, f.storage, f.diagnostics, f.connection.signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves); t.after(() => other.dispose());
	await assert.rejects(other.execute('studio_read_diagnostics', { receipt: read.receipt }), /this source context/);
	assert.equal(compute.mock.callCount(), 0);
});

test('dependency changes retire diagnostic receipts even when the queried source version is unchanged', async t => {
	const f = fixture(t), read = await f.read('cart.lua');
	const dependency = f.models.retain({ domain: 0, path: 'dependency.lua', source: { type: 'lua', resid: 'dependency' } }, 'lua', 'old = 1');
	await f.tools.execute('studio_read_diagnostics', { receipt: read.receipt });
	dependency.pushEditOperations([{ offset: 0, deleteLength: 3, text: 'new' }]);
	assert.equal(f.models.get(f.sources.luaResources[0])!.version, read.version);
	await assert.rejects(f.tools.execute('studio_read_diagnostics', { receipt: read.receipt }), /Source changed/);
	dependency.undo();
	await assert.rejects(f.tools.execute('studio_read_diagnostics', { receipt: read.receipt }), /Source changed/);
});

test('a synchronous source change during diagnostics publication cannot return a current receipt', async t => {
	const f = fixture(t), read = await f.read('cart.lua'), model = f.models.get(f.sources.luaResources[0])!;
	let changed = false;
	f.diagnostics.onDidChange(() => {
		if (changed) return;
		changed = true;
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- authored during publication\n' }]);
	});
	await assert.rejects(f.tools.execute('studio_read_diagnostics', { receipt: read.receipt }), /Source changed/);
});
