import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { captureCurrentLuaSource, captureLuaTextModelSources } from '../../ide/workbench/services/working_copy/lua_sources';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

test('source capture uses the operation document owner, not a global document with the same identity', t => {
	const record = createScenarioTestSourceRecord('entry.lua', 12, 'return "packed"');
	record.program_module = true;
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	const resource = sources.luaResources[0];
	const local = models.retain(resource, 'lua', record.src);
	local.pushEditOperations([{ offset: 0, deleteLength: local.buffer.length, text: 'return "local"' }]);
	const foreign = editorTextModelService.retain(resource, 'lua', record.src);
	foreign.pushEditOperations([{ offset: 0, deleteLength: foreign.buffer.length, text: 'return "foreign"' }]);
	t.after(() => { models.clear(); editorTextModelService.clear(); });
	assert.equal(local.version, foreign.version, 'path and version equality are not document ownership');
	assert.deepEqual(captureCurrentLuaSource(models, sources, resource), { source: local.buffer.getText(), revision: local.version });
	assert.deepEqual(captureLuaTextModelSources(models, sources), [{ ...local.createSnapshot(), domain: 0, path: 'entry.lua' }]);
});

test('an unopened source uses its own workspace record even when another workspace has an open document', t => {
	const record = createScenarioTestSourceRecord('suite_assert.lua', 12, 'return "workspace"');
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	const resource = sources.luaResources[0];
	editorTextModelService.retain(resource, 'lua', 'return "other workspace"');
	t.after(() => { models.clear(); editorTextModelService.clear(); });
	assert.deepEqual(captureCurrentLuaSource(models, sources, resource), { source: record.src, revision: 12 });
	assert.deepEqual(captureLuaTextModelSources(models, sources, true), []);
});
