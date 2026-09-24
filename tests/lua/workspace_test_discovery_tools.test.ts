import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { WorkspaceTestTools } from '../../ide/workbench/services/assistant/test_tools';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, empty = false) {
	const sources = createScenarioTestSourceState(empty ? [] : [createScenarioTestSourceRecord('suite_assert.lua', 7)]);
	const models = new EditorTextModelService(), connection = new AbortController();
	const service = new ScenarioRunService(models, sources, null, null, new Map(), PSX_MACHINE_SPEC,
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
	const model = f.models.retain(f.sources.luaResources[0], 'lua', 'end end');
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

test('foreign scopes and scopes from replaced cartridge sources cannot acquire execution authority', async t => {
	const f = fixture(t), peer = new WorkspaceTestTools(f.service, f.connection.signal); t.after(() => peer.dispose());
	const before = await f.tools.execute('studio_list_tests', {}); assert.ok(before.kind === 'tests');
	const scope = before.data.roots[0].scope;
	assert.throws(() => peer.execute('studio_start_test_run', { scope }), /must be discovered/);
	const replacement = createScenarioTestSourceState([createScenarioTestSourceRecord('suite_assert.lua', 7)]);
	f.sources.cartridgeSlots[0] = replacement.cartridgeSlots[0];
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope }), /source owner changed/);
	const after = await f.tools.execute('studio_list_tests', {}); assert.ok(after.kind === 'tests');
	assert.notEqual(after.data.roots[0].scope, scope);
	assert.throws(() => f.tools.execute('studio_start_test_run', { scope }), /must be discovered/);
	assert.equal(f.service.results.runs.length, 0);
});

test('empty history is not a passing workspace; explicit discovery sees newly admitted source-only suites', async t => {
	const f = fixture(t, true);
	const empty = await f.tools.execute('studio_list_tests', {}); assert.ok(empty.kind === 'tests');
	assert.deepEqual(empty.data.roots, []);
	assert.deepEqual(await f.tools.execute('studio_list_test_runs', {}), { kind: 'test-runs', data: { coverage: 'retained-studio-runs', revision: 0, runs: [] } });
	const added = createScenarioTestSourceRecord('added_assert.lua', 10);
	registerLuaSourceRecord(f.sources.cartridgeSlots[0]!.luaSources, added);
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
