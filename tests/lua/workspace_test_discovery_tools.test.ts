import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { WorkspaceTestTools } from '../../ide/workbench/services/assistant/test_tools';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { advanceLuaSourceRevision, createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, empty = false) {
	const sources = createScenarioTestSourceState(empty ? [] : [createScenarioTestSourceRecord('suite_assert.lua', 7)]);
	const models = new EditorTextModelService(), connection = new AbortController();
	const service = new ScenarioRunService(models, sources, new Map(), PSX_MACHINE_SPEC,
		() => assert.fail('discovery and rejected admission never construct a target'));
	const tools = new WorkspaceTestTools(service, connection.signal);
	t.after(() => { tools.dispose(); service.dispose(); models.clear(); });
	return { tools, service, sources, models, connection };
}

test('discovery projects working copies and diagnostics without running registration; unchanged reads reuse the snapshot', async t => {
	const f = fixture(t);
	const first = await f.tools.execute('studio_list_tests', {}); assert.ok(first.kind === 'tests');
	assert.equal(first.data.roots[0].testCount, 1);
	assert.equal(first.data.roots[0].modules[0].cases[0].name, 'sample');
	const model = f.models.retain(f.sources.catalog.luaResources[0], 'lua', 'end end');
	const invalid = await f.tools.execute('studio_list_tests', {}); assert.ok(invalid.kind === 'tests');
	assert.equal(invalid.data.roots[0].testCount, 0);
	assert.equal(invalid.data.roots[0].modules[0].kind, null);
	assert.ok(invalid.data.roots[0].modules[0].diagnostic!.line > 0);
	assert.deepEqual(invalid.data.roots[0].modules[0].cases, []);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: invalid.data.roots[0].scope }), /Unexpected/);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length,
		text: "return { kind = 'integration', tests = { renamed = function(t) t:wait_ticks(1) end } }" }]);
	const current = await f.tools.execute('studio_list_tests', {}); assert.ok(current.kind === 'tests');
	assert.equal(current.data.roots[0].modules[0].sourceRevision, model.version);
	assert.equal(current.data.roots[0].modules[0].kind, 'integration');
	assert.equal(current.data.roots[0].modules[0].diagnostic, null);
	assert.equal(current.data.roots[0].modules[0].cases[0].range.start.line, 1);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: first.data.roots[0].modules[0].cases[0].scope }), /must be discovered/);
	t.mock.method(LuaParser.prototype, 'parseChunk', () => assert.fail('unchanged declarations must not reparse'));
	t.mock.method(f.models, 'get', () => assert.fail('unchanged discovery must not reread working copies'));
	for (let read = 0; read < 1000; read++) assert.equal((await f.tools.execute('studio_list_tests', {})).data, current.data);
	assert.equal(f.service.results.runs.length, 0);
});

test('foreign scopes reject while installed replacement preserves authored discovery authority', async t => {
	const f = fixture(t), peer = new WorkspaceTestTools(f.service, f.connection.signal); t.after(() => peer.dispose());
	const before = await f.tools.execute('studio_list_tests', {}); assert.ok(before.kind === 'tests');
	const scope = before.data.roots[0].scope;
	assert.throws(() => peer.execute('studio_start_test_run', { scope }), /must be discovered/);
	const replacement = createScenarioTestSourceState([createScenarioTestSourceRecord('suite_assert.lua', 7)]);
	f.sources.cartridgeSlots[0] = replacement.cartridgeSlots[0];
	const detached = await f.tools.execute('studio_list_tests', {}); assert.ok(detached.kind === 'tests');
	assert.equal(detached.data.roots[0].scope, scope, 'physical media does not own source discovery');
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, createScenarioTestSourceRecord('suite_assert.lua', 8));
	const after = await f.tools.execute('studio_list_tests', {}); assert.ok(after.kind === 'tests');
	assert.equal(after.data.roots[0].scope, scope, 'editing a source does not replace its project selection');
	assert.equal(after.data.roots[0].modules[0].sourceRevision, 8);
	assert.equal(f.service.results.runs.length, 0);
});

test('retiring one source root revokes only its scopes and cannot revive them through the same project name', async t => {
	const f = fixture(t), catalog = f.sources.catalog;
	const primary = catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]);
	const peer = createLuaSourceRegistry('carts/peer', '');
	registerLuaSourceRecord(peer, createScenarioTestSourceRecord('peer_assert.lua', 3, undefined, 'carts/peer/peer_assert.lua'));
	catalog.admitContext({ ...primary, admission: { id: 'peer-source', projectRoot: 'carts/peer' }, luaSources: peer,
		sourceRoots: [{ path: 'carts/peer', resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'project' }], previewRom: null });
	const before = await f.tools.execute('studio_list_tests', {}); assert.ok(before.kind === 'tests');
	const retired = before.data.roots.find(root => root.contextId === primary.id)!;
	const survivor = before.data.roots.find(root => root.contextId === 'peer-source')!;
	const admitted = new Error('run admission reached');
	const start = t.mock.method(f.service, 'start', () => { throw admitted; });
	const registry = primary.luaSources, record = registry.records[0];
	registry.records.length = 0;
	delete registry.path2lua[record.source_path]; delete registry.module2lua[record.module_path];
	advanceLuaSourceRevision(registry); catalog.rebuildResources();
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: retired.scope }), /source owner changed/);
	assert.equal(start.mock.callCount(), 0);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: survivor.scope }), error => error === admitted);
	assert.equal(start.mock.calls[0].arguments[0], `scenario-root:peer-source`);
	registerLuaSourceRecord(registry, record);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: retired.scope }), /source owner changed/);
	const after = await f.tools.execute('studio_list_tests', {}); assert.ok(after.kind === 'tests');
	assert.notEqual(after.data.roots.find(root => root.contextId === primary.id)!.scope, retired.scope);
	assert.equal(after.data.roots.find(root => root.contextId === 'peer-source')!.scope, survivor.scope);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: survivor.scope }), error => error === admitted);
	assert.equal(start.mock.callCount(), 2);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope: retired.scope }), /must be discovered/);
	assert.equal(f.service.results.runs.length, 0);
});

test('empty history is not a passing workspace; explicit discovery sees newly admitted source-only suites', async t => {
	const f = fixture(t, true);
	const empty = await f.tools.execute('studio_list_tests', {}); assert.ok(empty.kind === 'tests');
	assert.deepEqual(empty.data.roots, []);
	assert.deepEqual(await f.tools.execute('studio_list_test_runs', {}), { kind: 'test-runs', data: { coverage: 'retained-studio-runs', revision: 0, runs: [] } });
	const added = createScenarioTestSourceRecord('added_assert.lua', 10);
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, added);
	const discovery = await f.tools.execute('studio_list_tests', {}); assert.ok(discovery.kind === 'tests');
	assert.equal(discovery.data.roots[0].modules[0].resource.path, added.source_path);
	assert.equal(discovery.data.roots[0].testCount, 1);
	assert.equal(f.service.results.runs.length, 0);
});

test('test operations decode external arguments once and retire with the connection', async t => {
	const f = fixture(t);
	for (const name of ['studio_list_tests', 'studio_list_test_runs']) {
		for (const input of [null, [], { scope: 'invented' }]) assert.throws(() => f.tools.execute(name, input));
	}
	for (const input of [{}, { scope: 4 }, { scope: 'invented', source: 'return true' }]) assert.throws(() => f.tools.execute('studio_start_test_run', input));
	for (const name of ['studio_wait_test_run', 'studio_cancel_test_run']) {
		for (const input of [{}, { run: false }, { run: 'invented', timeout: 5000 }, { run: 'invented' }]) assert.throws(() => f.tools.execute(name, input));
	}
	const cancelled = new AbortController(); cancelled.abort(new Error('request retired'));
	assert.throws(() => f.tools.execute('studio_list_tests', {}, cancelled.signal), /request retired/);
	f.connection.abort();
	assert.throws(() => f.tools.execute('studio_list_tests', {}), /disposed/);
	assert.equal(f.service.results.runs.length, 0);
});
