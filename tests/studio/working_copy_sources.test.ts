import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { EditorEditStateType } from '../../ide/editor/model/edit_state';
import { captureCurrentLuaSource, captureLuaTextModelSources } from '../../ide/workbench/services/working_copy/lua_sources';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

test('source capture uses the operation document owner, not a global document with the same identity', t => {
	const record = { ...createScenarioTestSourceRecord('entry.lua', 12, 'return "packed"'), sourceKind: 'project' as const, program_module: true };
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	const resource = sources.catalog.luaResources[0];
	const local = models.retain(resource, 'lua', record.src);
	local.pushEditOperations([{ offset: 0, deleteLength: local.buffer.length, text: 'return "local"' }]);
	const foreign = editorTextModelService.retain(resource, 'lua', record.src);
	foreign.pushEditOperations([{ offset: 0, deleteLength: foreign.buffer.length, text: 'return "foreign"' }]);
	t.after(() => { models.clear(); editorTextModelService.clear(); });
	assert.equal(local.version, foreign.version, 'path and version equality are not document ownership');
	assert.deepEqual(captureCurrentLuaSource(models, sources.catalog, resource), { source: local.buffer.getText(), revision: local.version });
	assert.deepEqual(captureLuaTextModelSources(models, sources.catalog), [{ source: local.buffer.getText(), version: local.version,
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'entry.lua' }]);
});

test('an unopened source uses its own workspace record even when another workspace has an open document', t => {
	const record = createScenarioTestSourceRecord('suite_assert.lua', 12, 'return "workspace"');
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	const resource = sources.catalog.luaResources[0];
	editorTextModelService.retain(resource, 'lua', 'return "other workspace"');
	t.after(() => { models.clear(); editorTextModelService.clear(); });
	assert.deepEqual(captureCurrentLuaSource(models, sources.catalog, resource), { source: record.src, revision: 12 });
	assert.deepEqual(captureLuaTextModelSources(models, sources.catalog, true), []);
});

test('runtime source capture pins text without splitting the typing Undo sequence', t => {
	const record = { ...createScenarioTestSourceRecord('entry.lua', 12, 'abc'), sourceKind: 'project' as const, program_module: true };
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	const model = models.retain(sources.catalog.luaResources[0], 'lua', record.src);
	const state = new EditorEditStateType<void>();
	t.after(() => models.clear());
	model.prepareUndo('typing', true, 1, state.of(undefined));
	model.applyUndoableReplace(3, 0, 'X');
	model.commitEdit(state.of(undefined), null);
	const captured = captureLuaTextModelSources(models, sources.catalog);
	model.prepareUndo('typing', true, 2, state.of(undefined));
	model.applyUndoableReplace(4, 0, 'Y');
	model.commitEdit(state.of(undefined), null);
	assert.equal(captured[0].source, 'abcX', 'the runtime input keeps its captured generation');
	model.undo();
	assert.equal(model.buffer.getText(), 'abc', 'reading build input must not split a typing group');
	assert.equal(model.dirty, false);
	model.redo();
	assert.equal(model.buffer.getText(), 'abcXY');
});

test('runtime source capture during edit admission leaves the pending Undo record intact', t => {
	const record = { ...createScenarioTestSourceRecord('entry.lua', 12, 'abc'), sourceKind: 'project' as const, program_module: true };
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	const model = models.retain(sources.catalog.luaResources[0], 'lua', record.src);
	const state = new EditorEditStateType<void>();
	const captures: string[] = [];
	model.onWillChangeContent(() => { captures.push(captureLuaTextModelSources(models, sources.catalog)[0].source); });
	t.after(() => models.clear());
	model.prepareUndo('typing', true, 1, state.of(undefined));
	model.applyUndoableReplace(3, 0, 'X');
	assert.equal(model.commitEdit(state.of(undefined), null), true);
	assert.deepEqual(captures, ['abc']);
	assert.equal(model.buffer.getText(), 'abcX');
	model.undo();
	assert.equal(model.buffer.getText(), 'abc');
});
