import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject, resetSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

const contextId = TEST_CARTRIDGE_CONTEXT_IDS[0];
const SOURCE = `local publish = require('bridge')
publish('same', { objects = { { member_id = 'one', definition_id = 'sprite' } } })
publish('same', { objects = {} })`;
const PROVIDER = "return require('cartlib/world/scene_library').register";

function fixture(t: TestContext) {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, 'return {}'),
		createScenarioTestSourceRecord('scene.lua', 1, SOURCE),
		createScenarioTestSourceRecord('bridge.lua', 1, PROVIDER),
		createScenarioTestSourceRecord('other.lua', 1, 'return false'),
	]);
	const models = new EditorTextModelService(), documents = new SceneSourceDocuments(models, sources.catalog);
	const resource = (path: string) => sources.catalog.resolveResource({ contextId, path })!;
	const model = (path: string) => resolveLuaTextFileModel(models, sources.catalog, resource(path));
	const project = getOrCreateSemanticProject(models, contextId);
	project.synchronizeSources(sources.catalog);
	t.after(() => { models.clear(); resetSemanticProjects(models); sources.catalog.dispose(); });
	return { sources, models, documents, resource, model, project };
}

test('Scene discovery and canonical consumers share one source projection without opening discovery models', t => {
	const f = fixture(t), snapshot = f.project.getSnapshot();
	const getSnapshot = t.mock.method(f.project, 'getSnapshot');
	const synchronize = t.mock.method(f.project, 'synchronizeSources');
	const document = f.documents.getForSnapshot(f.resource('scene.lua'), snapshot);
	for (let client = 0; client < 100; client++) assert.equal(f.documents.getForSnapshot(f.resource('scene.lua'), snapshot), document);
	assert.equal(getSnapshot.mock.callCount(), 0);
	assert.equal(synchronize.mock.callCount(), 0);
	assert.equal([...f.models.models].length, 0, 'source discovery is not model admission');
	const model = f.model('scene.lua');
	const projectSnapshot = t.mock.method(f.documents, 'getForSnapshot');
	assert.equal(f.documents.get(model), document);
	for (let client = 0; client < 100; client++) assert.equal(f.documents.get(model), document);
	assert.equal(projectSnapshot.mock.callCount(), 1, 'canonical steady-state reads do not recreate addresses or query the generation cache');
	assert.equal(document.scenes.length, 2);
	assert.notEqual(document.scenes[0], document.scenes[1], 'equal semantic IDs remain separate authored occurrences');
});

test('Scene projections retain unchanged source and follow provider proof without mutating older generations', t => {
	const f = fixture(t), model = f.model('scene.lua'), document = f.documents.get(model);
	const originalSnapshot = f.project.getSnapshot();
	f.model('other.lua').pushEditOperations([{ offset: 7, deleteLength: 5, text: 'true' }]);
	assert.equal(f.documents.get(model), document, 'unrelated source cannot retire another context\'s field bindings');
	const provider = f.model('bridge.lua');
	provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- same binding\n' }]);
	assert.equal(f.documents.get(model), document, 'unchanged import proof retains the projected source');
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	const revoked = f.documents.get(model);
	assert.notEqual(revoked, document);
	assert.equal(revoked.scenes.length, 0);
	assert.equal(document.scenes.length, 2, 'a retained source generation is immutable');
	assert.equal(f.documents.getForSnapshot(f.resource('scene.lua'), originalSnapshot), document);
	provider.undo();
	assert.equal(f.documents.get(model).scenes.length, 2);
	assert.equal(model.buffer.getText(), SOURCE);
	assert.equal(model.dirty, false);
});

test('Scene cache namespaces end with their actual semantic project, not just a repeated context/path', t => {
	const f = fixture(t), model = f.model('scene.lua'), first = f.documents.get(model);
	resetSemanticProject(f.models, contextId);
	const second = f.documents.get(model);
	assert.notEqual(second, first);
	assert.equal(second.scenes.length, 2);
	assert.equal(f.documents.get(model), second);
});

test('project content and opened Scene views consume the exact same declaration objects', t => {
	const f = fixture(t), registrations = new BehaviorRegistrationIndex(f.models, f.sources.catalog);
	const index = new ProjectContentIndex(f.models, f.sources.catalog, registrations, f.documents);
	t.after(() => index.dispose());
	index.sync();
	const entries = index.entriesFor(f.resource('scene.lua'));
	assert.equal([...f.models.models].length, 0);
	const model = f.model('scene.lua'), document = f.documents.get(model);
	assert.equal(entries.length, 2);
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		assert.ok(entry.kind === 'scene');
		assert.equal(entry.document, document);
		assert.equal(entry.definition, document.scenes[index]);
	}
});
