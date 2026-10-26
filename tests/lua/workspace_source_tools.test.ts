import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { ScenarioTestCollection } from '../../ide/testing/scenario/test_collection';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { EditorTextModelService, editorTextModelService, type ResolvedTextModelSource } from '../../ide/editor/model/model_service';
import { resourceIdentityKey, type RuntimeResource } from '../../ide/common/resource';
import { WorkspaceSourceTools } from '../../ide/workbench/services/assistant/source_tools';
import { StudioToolInputError } from '../../ide/workbench/services/assistant/tool_input';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { workspaceCanonicalSourceCache } from '../../ide/workspace/cache';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { rebuildRuntimeSourceResources } from '../../ide/runtime/sources';
import { createTextResource, discoverWorkspaceSources } from '../../ide/workspace/workspace';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';

function fixture(t: TestContext) {
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1, 'return old -- saved\n')]);
	const models = new EditorTextModelService(), connection = new AbortController();
	const storage = { getItem: () => null, setItem: () => assert.fail('Tools must not save'), removeItem: () => assert.fail('Tools must not delete') };
	const yaml: RuntimeResource = { location: { kind: 'project', projectRootPath: 'carts/nemesis_s', path: 'res/data/stage.yaml' }, domain: 0, path: 'res/data/stage.yaml', source: { type: 'data', resid: 'stage' } };
	const binary: RuntimeResource = { location: { kind: 'project', projectRootPath: 'carts/nemesis_s', path: 'art.png' }, domain: 0, path: 'art.png', source: { type: 'image', resid: 'art' } };
	sources.resourceByIdentity.set(resourceIdentityKey(yaml), yaml); sources.resourceByIdentity.set(resourceIdentityKey(binary), binary);
	const yamlPath = 'carts/nemesis_s/res/data/stage.yaml';
	const yamlSource = '# exact 🐉\r\nvalue: old\r\n';
	workspaceCanonicalSourceCache.set(yamlPath, { contents: yamlSource, updatedAt: 1 });
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const guest = new SuspendedGuestSession(runtime);
	const { tasks, presenter } = createRuntimeInspectionFixture(runtime, sources, guest);
	const diagnostics = new ResourceDiagnosticsService(models, sources, new VirtualHeadlessClock());
	const saves = new TextFileSaveService(models, new VirtualHeadlessClock(), sources, guest, runtime, tasks);
	const tools = new WorkspaceSourceTools(models, sources, diagnostics, connection.signal, new BehaviorSourceDocuments(models, sources), saves, new VirtualHeadlessClock());
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
	const tools = new WorkspaceSourceTools(f.models, f.sources, f.diagnostics, f.connection.signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves, new VirtualHeadlessClock()); t.after(() => tools.dispose());
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
	const other = new WorkspaceSourceTools(f.models, f.sources, f.diagnostics, new AbortController().signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves, new VirtualHeadlessClock()); t.after(() => other.dispose());
	await assert.rejects(other.execute('studio_read_source', { resource: catalog[0].resource }), /does not belong/);
	await assert.rejects(other.execute('studio_read_source', { resource: '../../etc/passwd' }), /does not belong/);
	await assert.rejects(other.execute('studio_propose_edits', { title: 'Old rights', files: [{ receipt: first.receipt,
		edits: [{ offset: 0, deleteLength: 0, text: 'no', expectedText: '' }] }] }), /needs a receipt/);
});

test('YAML admission delayed past teardown cannot capture a model from a replacement workspace', async t => {
	const f = fixture(t);
	const source = Promise.withResolvers<ResolvedTextModelSource>();
	const pending = f.models.resolve(f.yaml, 'yaml', () => source.promise);
	const resource = (await f.list()).find(source => source.path === f.yaml.path)!;
	const reading = f.tools.execute('studio_read_source', { resource: resource.resource });
	f.models.clear();
	source.resolve({ source: f.yamlSource, persistedBaseline: f.yamlSource });
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
	const a = await resolveTextFileModel(f.models, f.sources, f.yaml);
	const b = await resolveTextFileModel(f.models, f.sources, f.yaml);
	assert.equal(a, b); assert.equal(f.models.get(f.yaml), a);
	assert.equal(editorTextModelService.get(f.yaml), undefined);
});

test('diagnostic receipts preserve exact unsaved source coordinates and reuse the ordinary resource results', async t => {
	const f = fixture(t);
	const lua = f.models.retain(f.sources.luaResources[0], 'lua', 'return old -- saved\n');
	const prefix = "local before = '🐉'; return ";
	lua.pushEditOperations([{ offset: 0, deleteLength: lua.buffer.length, text: `-- 🐉\r\n${prefix}missing_after_unicode\r\n` }]);
	f.tools.dispose();
	const tools = new WorkspaceSourceTools(f.models, f.sources, f.diagnostics, f.connection.signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves, new VirtualHeadlessClock()); t.after(() => tools.dispose());
	const catalog = await tools.execute('studio_list_sources', {}); assert.ok(catalog.kind === 'sources');
	const read = await tools.execute('studio_read_source', { resource: catalog.data[0].resource }); assert.ok(read.kind === 'source');
	const result = await tools.execute('studio_read_diagnostics', { receipt: read.data.receipt }); assert.ok(result.kind === 'diagnostics');
	assert.equal(result.data.receipt, read.data.receipt); assert.equal(result.data.version, read.data.version);
	assert.ok(result.data.status === 'ready');
	const marker = result.data.diagnostics.find(diagnostic => diagnostic.message.includes('missing_after_unicode'))!;
	assert.equal(marker.row, 1); assert.equal(marker.startColumn, prefix.length);
	assert.equal(marker.endColumn, prefix.length + 'missing_after_unicode'.length);
	const shared = f.diagnostics.get(lua)!; assert.ok(shared.status === 'ready');
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
	assert.equal(f.models.get(f.sources.luaResources[0]), undefined, 'listing never analyzes or claims clean unopened resources');
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
	const other = new WorkspaceSourceTools(f.models, f.sources, f.diagnostics, f.connection.signal, new BehaviorSourceDocuments(f.models, f.sources), f.saves, new VirtualHeadlessClock()); t.after(() => other.dispose());
	await assert.rejects(other.execute('studio_read_diagnostics', { receipt: read.receipt }), /this source context/);
	assert.equal(compute.mock.callCount(), 0);
});

test('dependency changes retire diagnostic receipts even when the queried source version is unchanged', async t => {
	const f = fixture(t), read = await f.read('cart.lua');
	const dependency = f.models.retain({ location: { kind: 'workspace' as const, path: 'dependency.lua' }, domain: 0, path: 'dependency.lua', source: { type: 'lua', resid: 'dependency' } }, 'lua', 'old = 1');
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


test('new Scenario source stays a review until exclusive creation; discovery consumes the canonical file', async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const f = fixture(t);
	const source = "return { kind = 'unit', tests = { works = function() assert(2 + 2 == 4) end } }";
	const result = await f.tools.execute('studio_propose_source', { title: 'A reproducible case', domain: 0, path: 'tools_assert.lua', source });
	assert.ok(result.kind === 'proposal');
	assert.equal(await files.read('carts/nemesis_s/tools_assert.lua'), null);
	assert.equal(f.sources.luaResources.some(resource => resource.path === 'tools_assert.lua'), false);
	const models = await result.proposal.apply();
	assert.equal(result.proposal.state, 'applied');
	assert.equal((await files.read('carts/nemesis_s/tools_assert.lua'))!.contents, source);
	assert.equal(models[0].buffer.getText(), source);
	assert.equal(models[0].dirty, false);
	const collection = new ScenarioTestCollection(f.sources); collection.refresh();
	assert.ok(collection.roots.some(root => root.children.some(module => module.resource.path === 'tools_assert.lua')));
});

for (const [path, source, mode] of [
	['res/data/events.aem.yaml', '# authored map\nevents: {}\n', 'aem'],
	['res/data/events.aem.json', '{ "events": {} }\n', 'aem'],
	['res/data/level.yaml', '# authored level\nwidth: 320\n', 'yaml'],
] as const) test(`new ${mode} source survives catalog rebuilding and workspace reopening before compilation: ${path}`, async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const f = fixture(t);
	const canonicalPath = `carts/nemesis_s/${path}`;
	t.after(() => workspaceCanonicalSourceCache.delete(canonicalPath));
	const result = await f.tools.execute('studio_propose_source', { title: 'Authored asset', domain: 0, path, source });
	assert.ok(result.kind === 'proposal');
	assert.equal(await files.read(canonicalPath), null);
	assert.equal(f.sources.resources.some(resource => resource.path === path), false);
	const [model] = await result.proposal.apply();
	assert.equal(model.mode, mode);
	assert.equal(model.buffer.getText(), source);
	assert.equal((await files.read(canonicalPath))!.contents, source);
	assert.equal(model.resource.source.sourcemeta, undefined, 'new authored source is not installed asset evidence');
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, model), 'pending');
	assert.equal(f.sources.luaResources.some(resource => resource.path === path), false);
	rebuildRuntimeSourceResources(f.sources);
	assert.equal(f.sources.resourceByIdentity.get(resourceIdentityKey(model.resource)), model.resource);
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, model), 'pending');
	const reopened = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1)]);
	await discoverWorkspaceSources(reopened);
	const resource = reopened.resources.find(resource => resource.path === path)!;
	assert.ok(resource);
	const models = new EditorTextModelService(); t.after(() => models.clear());
	const restored = await resolveTextFileModel(models, reopened, resource);
	assert.equal(restored.mode, mode);
	assert.equal(restored.buffer.getText(), source);
	assert.equal(getTextFileRuntimeSourceStatus(reopened, restored), 'pending');
});

test('new source review displays and creates the same canonical identity', async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const f = fixture(t);
	const result = await f.tools.execute('studio_propose_source', { title: 'Canonical map', domain: 0,
		path: 'res/temporary/../data/events.aem.yaml', source: 'events: {}\n' });
	assert.ok(result.kind === 'proposal');
	assert.deepEqual(result.proposal.files[0].identity, { domain: 0, path: 'res/data/events.aem.yaml' });
	const [model] = await result.proposal.apply();
	assert.deepEqual(model.identity, result.proposal.files[0].identity);
	assert.equal((await files.read('carts/nemesis_s/res/data/events.aem.yaml'))!.contents, 'events: {}\n');
	t.after(() => workspaceCanonicalSourceCache.delete('carts/nemesis_s/res/data/events.aem.yaml'));
});

test('structured source creation and reopening share excluded-folder admission', async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1)]);
	for (const directory of ['.bmsx', '.git', '_ignore', 'node_modules', 'test']) {
		for (const name of ['events.aem.yaml', 'events.aem.json', 'level.yaml']) {
			const relativePath = `res/${directory}/${name}`;
			const path = `carts/nemesis_s/${relativePath}`;
			await assert.rejects(createTextResource(new VirtualHeadlessClock(), sources,
				{ domain: 0, relativePath, contents: 'events: {}\n' }), /project source folder/);
			assert.equal(await files.read(path), null);
			assert.equal(sources.resources.some(resource => resource.path === relativePath), false);
			await files.write(path, { contents: 'events: {}\n', updatedAt: 1 }, false);
		}
	}
	await discoverWorkspaceSources(sources);
	assert.deepEqual(sources.resources.map(resource => resource.path), ['cart.lua']);
});

for (const name of ['events.aem.yaml', 'level.yaml']) test(`workspace reopening rejects duplicate unbuilt asset identities: ${name}`, async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const first = `carts/nemesis_s/res/a/${name}`, second = `carts/nemesis_s/res/b/${name}`;
	await files.write(first, { contents: '{}\n', updatedAt: 1 }, false);
	await files.write(second, { contents: '{}\n', updatedAt: 2 }, false);
	t.after(() => { workspaceCanonicalSourceCache.delete(first); workspaceCanonicalSourceCache.delete(second); });
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1)]);
	await assert.rejects(discoverWorkspaceSources(sources), /already belongs to res\/a\//);
	assert.deepEqual(sources.resources.map(resource => resource.path), ['cart.lua'], 'no partial structured catalog is published');
});

test('new structured sources reject logical identities already admitted under another path', async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1)]);
	const clock = new VirtualHeadlessClock();
	const original = await createTextResource(clock, sources,
		{ domain: 0, relativePath: 'res/data/events.aem.yaml', contents: 'events: {}\n' });
	t.after(() => workspaceCanonicalSourceCache.delete('carts/nemesis_s/res/data/events.aem.yaml'));
	await assert.rejects(createTextResource(clock, sources,
		{ domain: 0, relativePath: 'res/other/events.aem.json', contents: '{ "events": {} }\n' }), /already belongs to res\/data\/events.aem.yaml/);
	assert.equal(await files.read('carts/nemesis_s/res/other/events.aem.json'), null);
	assert.equal(sources.resourceByIdentity.get(resourceIdentityKey(original)), original);
});

for (const [first, second] of [
	['res/data/events.aem.yaml', 'res/other/events.aem.json'],
	['same name.lua', 'samename.lua'],
] as const) test(`concurrent source creation serializes logical identity admission: ${first}`, async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1)]);
	const clock = new VirtualHeadlessClock();
	const creation = createTextResource(clock, sources, { domain: 0, relativePath: first, contents: '{}\n' });
	const collision = createTextResource(clock, sources, { domain: 0, relativePath: second, contents: '{}\n' });
	const rejected = assert.rejects(collision, /already belongs to/);
	const resource = await creation;
	await rejected;
	assert.equal((await files.read(`carts/nemesis_s/${first}`))!.contents, '{}\n');
	assert.equal(await files.read(`carts/nemesis_s/${second}`), null, 'logical collision is rejected before writing another file');
	assert.equal(sources.resources.filter(candidate => candidate.source.resid === resource.source.resid).length, 1);
	t.after(() => workspaceCanonicalSourceCache.delete(`carts/nemesis_s/${first}`));
});

for (const path of ['new.lua', 'res/data/events.aem.yaml']) for (const end of ['discard', 'disconnect', 'changed', 'collision'] as const) test(`new source review ${path}: ${end} does not overwrite source`, async t => {
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files); t.after(closeWorkspaceRecords);
	const f = fixture(t);
	const result = await f.tools.execute('studio_propose_source', { title: 'New source', domain: 0, path, source: 'return 1' });
	assert.ok(result.kind === 'proposal');
	if (end === 'discard') result.proposal.dispose();
	if (end === 'disconnect') f.connection.abort();
	if (end === 'changed') {
		const model = await resolveTextFileModel(f.models, f.sources, f.sources.luaResources[0]);
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
	}
	if (end === 'collision') {
		await files.write(`carts/nemesis_s/${path}`, { contents: 'return 99', updatedAt: 1 }, false);
		await assert.rejects(async () => result.proposal.apply());
		assert.equal(result.proposal.state, 'failed');
		assert.equal((await files.read(`carts/nemesis_s/${path}`))!.contents, 'return 99');
	} else {
		assert.throws(() => result.proposal.apply());
		assert.equal(await files.read(`carts/nemesis_s/${path}`), null);
	}
	assert.equal(f.sources.resources.some(resource => resource.path === path), false);
});
