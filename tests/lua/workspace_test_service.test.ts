import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { ScenarioRunAdmissionError, ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { ScenarioLabController } from '../../ide/workbench/contrib/scenario_lab/controller';

function fixture(t: TestContext) {
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('suite_assert.lua', 12)]);
	const models = new EditorTextModelService();
	const runs = new ScenarioRunService(models, sources, null, null, new Map(), PSX_MACHINE_SPEC, () => assert.fail('discovery cannot create a machine'));
	t.after(() => { runs.dispose(); models.clear(); editorTextModelService.clear(); });
	return { sources, models, runs, module: runs.collection.roots[0].children[0] };
}

test('workspace test discovery consumes its actual document owner without constructing a view or machine', t => {
	const f = fixture(t);
	const local = f.models.retain(f.sources.luaResources[0], 'lua', f.module.source);
	local.pushEditOperations([{ offset: 0, deleteLength: local.buffer.length, text: "return { kind = 'unit', tests = { current = function() end } }" }]);
	const foreign = editorTextModelService.retain(local.resource, 'lua', f.module.source);
	foreign.pushEditOperations([{ offset: 0, deleteLength: foreign.buffer.length, text: 'end end -- unrelated workspace' }]);
	assert.equal(local.version, foreign.version);
	f.runs.refreshSources();
	assert.deepEqual(f.module.children.map(test => test.caseName), ['current']);
	assert.equal(f.module.sourceTimestamp, local.version);
	t.mock.method(LuaParser.prototype, 'parseChunk', () => assert.fail('unchanged discovery cannot parse again'));
	t.mock.method(f.models, 'get', () => assert.fail('unchanged discovery cannot reread documents'));
	foreign.undo();
	for (let frame = 0; frame < 1000; frame++) f.runs.refreshSources();
});

test('stale and invalid selections reject synchronously before recording or executing a run', t => {
	const f = fixture(t), old = f.module.children[0].id;
	const model = f.models.retain(f.sources.luaResources[0], 'lua', f.module.source);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: "return { kind = 'unit', tests = { renamed = function() end } }" }]);
	assert.throws(() => f.runs.start(old), ScenarioRunAdmissionError);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'end end' }]);
	assert.throws(() => f.runs.start(f.module.id), LuaSyntaxError);
	assert.equal(f.runs.results.runs.length, 0); assert.equal(f.runs.active, false);
});

test('restoring working copies retires their old context without closing workspace test admission', t => {
	const f = fixture(t);
	const original = f.module.source;
	const model = f.models.retain(f.sources.luaResources[0], 'lua', original);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'end end' }]);
	f.runs.refreshSources();
	assert.ok(f.module.diagnostic instanceof LuaSyntaxError);
	f.models.clear();
	f.runs.refreshSources();
	assert.equal(f.module.diagnostic, null);
	assert.equal(f.module.source, original);
	assert.deepEqual(f.module.children.map(test => test.caseName), ['sample']);
	f.models.retain(f.sources.luaResources[0], 'lua', 'end end -- restored invalid suite');
	assert.throws(() => f.runs.start(f.module.id), LuaSyntaxError);
	assert.equal(f.runs.results.runs.length, 0);
});

test('disposing the view leaves workspace discovery alive; disposing the service closes admission', t => {
	const f = fixture(t);
	const view = new ScenarioLabController(null, null, null, null, f.runs);
	view.dispose();
	f.models.retain(f.sources.luaResources[0], 'lua', 'end end');
	assert.throws(() => f.runs.start(f.module.id), LuaSyntaxError);
	f.runs.dispose();
	assert.throws(() => f.runs.start(f.module.id), /closed/);
	assert.equal(f.runs.results.runs.length, 0);
});
