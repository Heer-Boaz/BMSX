import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput, UnavailableSceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { TextEditorInput } from '../../ide/workbench/common/editor_input';
import { SceneEditorInputSerializer } from '../../ide/workbench/contrib/scene_editor/editor_serializer';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {{ member_id='one', definition_id='actor' }} })
scenes.register('same', { objects = {{ member_id='two', definition_id='actor' }} })`;
const EXPRESSIONS = `local scenes = require('cartlib/world/scene_library')
local intro_scene = { id = 'intro' }
scenes.register(intro_scene.id, { objects = {} })
scenes.register(intro_scene.id, { objects = {} })`;

function fixture(t: TestContext) {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, 'return {}'),
		createScenarioTestSourceRecord('scene.lua', 1, SOURCE),
		createScenarioTestSourceRecord('other.lua', 1, SOURCE),
		createScenarioTestSourceRecord('expression.lua', 1, EXPRESSIONS),
	]);
	const documents = new SceneSourceDocuments(editorTextModelService, sources.catalog);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	const controller = new SceneEditorController(sources.catalog, documents), group = createTestEditorGroup();
	t.after(() => { group.dispose(); inputFocus.setTarget(null); editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); sources.catalog.dispose(); });
	const create = (index: number) => {
		const document = documents.get(model);
		return new SceneEditorInput(model, documents, sources.catalog, controller.createView,
			{ document, sourceVersion: model.version, scene: document.scenes[index] });
	};
	return { sources, documents, model, controller, group, create };
}

test('distinct same-named scene occurrences own separate tabs while admission returns the retained matching input', t => {
	const f = fixture(t), first = f.create(0), second = f.create(1);
	assert.equal(f.group.openProducedEditor(() => first), first);
	assert.equal(f.group.openProducedEditor(() => second), second);
	assert.notEqual(first.id, second.id); assert.equal(f.group.model.tabs.length, 2);
	assert.equal(first.title, 'same'); assert.equal(second.title, 'same');
	assert.notEqual(f.group.model.getLabel(first), f.group.model.getLabel(second));
	assert.equal(first.workingCopy, second.workingCopy);
	const provenance = first.description;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	assert.notEqual(first.description, provenance, 'tracked source provenance moves even while its tab is inactive');
	const offered = f.create(0);
	assert.notEqual(offered.id, first.id);
	assert.equal(f.group.openProducedEditor(() => offered), first);
	assert.equal(f.group.model.tabs.length, 2); assert.equal(f.group.model.activeTab, first);
	assert.equal(f.model.dirty, true); assert.ok(f.model.buffer.getText().startsWith('-- unsaved\n'));
});

test('Scene occurrence lookup borrows the exact retained input without admitting a model or changing its editor', t => {
	const f = fixture(t), document = f.documents.get(f.model);
	const ranges = document.scenes.map(scene => luaSourceRangeToTextRange(f.model.buffer, scene.range));
	t.after(f.model.trackRanges(new Map(ranges.map((range, index) => [index, range]))));
	const other = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'other.lua' })!;
	const otherModel = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, other);
	const models = [...editorTextModelService.models].length;
	assert.equal(f.controller.findDefinition(f.group, otherModel, ranges[0]), undefined);
	assert.equal([...editorTextModelService.models].length, models);
	assert.equal(f.controller.findDefinition(f.group, f.model, ranges[0]), undefined);
	assert.equal(f.controller.openDefinition(f.group, f.model.resource, ranges[0]), true);
	const first = f.group.model.activeTab;
	assert.equal(f.controller.openDefinition(f.group, f.model.resource, ranges[1]), true);
	const second = f.group.model.activeTab;
	assert.ok(first instanceof SceneEditorInput && second instanceof SceneEditorInput && first !== second);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	const source = f.model.buffer.getText(), version = f.model.version, selection = second.view.authoring.selection;
	const generation = f.group.panes.openGeneration, count = f.group.model.tabs.length;
	const query = t.mock.method(f.documents, 'get', () => assert.fail('retained lookup must not request semantic analysis'));
	assert.equal(f.controller.findDefinition(f.group, f.model, ranges[0]), first);
	assert.equal(f.controller.findDefinition(f.group, f.model, ranges[1]), second);
	assert.equal(f.controller.findDefinition(f.group, otherModel, ranges[0]), undefined);
	assert.equal(f.controller.findDefinition(f.group, f.model, { start: 0, end: 0 }), undefined);
	assert.equal(query.mock.callCount(), 0);
	query.mock.restore();
	assert.equal([...editorTextModelService.models].length, models);
	assert.equal(f.group.model.tabs.length, count); assert.equal(f.group.model.activeTab, second);
	assert.equal(f.group.panes.openGeneration, generation); assert.equal(second.view.authoring.selection, selection);
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, true);
});

test('Scene occurrence lookup follows an intact unavailable marker but never admits a removed occurrence', t => {
	const f = fixture(t), scene = f.documents.get(f.model).scenes[0];
	const range = luaSourceRangeToTextRange(f.model.buffer, scene.range);
	t.after(f.model.trackRanges(new Map([['scene', range]])));
	assert.equal(f.controller.openDefinition(f.group, f.model.resource, range), true);
	const input = f.group.model.activeTab; assert.ok(input instanceof SceneEditorInput);
	const offset = f.model.buffer.getText().indexOf('scenes.register');
	f.model.pushEditOperations([{ offset, deleteLength: 'scenes.register'.length, text: 'scenes.not_here' }]);
	assert.equal(input.view.authoring.suspended, true);
	assert.equal(f.controller.findDefinition(f.group, f.model, range), input);
	assert.equal(f.controller.prepareDefinition(f.group, f.model, range), undefined);
	f.model.undo();
	assert.equal(input.view.authoring.suspended, false);
	assert.equal(f.controller.findDefinition(f.group, f.model, range), input);
	assert.equal(f.controller.prepareDefinition(f.group, f.model, range)?.input, input);
	f.model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: '' }]);
	assert.equal(range.start, range.end);
	assert.equal(f.controller.findDefinition(f.group, f.model, range), undefined);
	assert.equal(f.controller.prepareDefinition(f.group, f.model, range), undefined);
});

test('unresolved scene expressions use source names and distinguish repeated occurrences', t => {
	const f = fixture(t), resource = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'expression.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.documents.get(model);
	const make = (index: number) => new SceneEditorInput(model, f.documents, f.sources.catalog, f.controller.createView,
		{ document, sourceVersion: model.version, scene: document.scenes[index] });
	const first = make(0), second = make(1);
	f.group.openProducedEditor(() => first); f.group.openProducedEditor(() => second);
	assert.ok(first.title.startsWith('expression.lua:')); assert.ok(second.title.startsWith('expression.lua:'));
	assert.notEqual(first.title, second.title);
	assert.notEqual(f.group.model.getLabel(first), f.group.model.getLabel(second));
	assert.ok(first.description.includes('intro_scene.id')); assert.ok(second.description.includes('intro_scene.id'));
	assert.equal(f.group.model.getLabel(first).includes('intro_scene.id'), false);
	assert.equal(f.group.model.getLabel(second).includes('intro_scene.id'), false);
});

test('scene tab names follow published literal changes without changing occurrence identity', t => {
	const f = fixture(t), first = f.create(0), second = f.create(1);
	f.group.openProducedEditor(() => first); f.group.openProducedEditor(() => second);
	const offset = f.model.buffer.getText().indexOf("'same'");
	f.model.pushEditOperations([{ offset, deleteLength: "'same'".length, text: "'MiXeD Scene'" }]);
	first.view.authoring.refresh(); second.view.authoring.refresh();
	assert.equal(first.title, 'MiXeD Scene'); assert.equal(second.title, 'same');
	assert.equal(f.group.model.getLabel(first), 'MiXeD Scene');
	assert.notEqual(first.id, second.id); assert.equal(f.group.model.tabs.length, 2);
});

test('identical scene ranges from different source models are not the same document', t => {
	const f = fixture(t), first = f.create(0);
	const resource = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'other.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.documents.get(model);
	const other = new SceneEditorInput(model, f.documents, f.sources.catalog, f.controller.createView,
		{ document, sourceVersion: model.version, scene: document.scenes[0] });
	assert.equal(f.group.openProducedEditor(() => first), first);
	assert.equal(f.group.openProducedEditor(() => other), other);
	assert.equal(f.group.model.tabs.length, 2); assert.notEqual(first.workingCopy, other.workingCopy);
});

test('scene input restoration retains an exact occurrence and does not guess after source changes', async t => {
	const f = fixture(t), input = f.create(1), serializer = new SceneEditorInputSerializer(f.sources.catalog, f.controller);
	t.after(() => input.dispose());
	const value = serializer.serialize(input), reference = input.view.authoring.captureSourceReference();
	const restored = await serializer.deserialize(value); t.after(() => restored.dispose());
	assert.ok(restored instanceof SceneEditorInput);
	assert.equal(restored.view.authoring.availability, 'available');
	assert.deepEqual(restored.view.authoring.captureSourceReference().subject, reference.subject);
	assert.equal(restored.view.authoring.subject, f.documents.get(f.model).scenes[1]);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
	const stale = await serializer.deserialize(value); t.after(() => stale.dispose());
	assert.ok(stale instanceof SceneEditorInput);
	assert.equal(stale.view.authoring.availability, 'unavailable');
	assert.equal(stale.view.authoring.subject, undefined);
	assert.deepEqual(stale.view.authoring.captureSourceReference().subject,
		{ range: reference.subject!.range, availability: 'unavailable' });
});

test('a missing scene source restores an unavailable document without inventing or reverting a working copy', async t => {
	const f = fixture(t), input = f.create(1), serializer = new SceneEditorInputSerializer(f.sources.catalog, f.controller);
	t.after(() => input.dispose());
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	const source = f.model.buffer.getText(), value = serializer.serialize(input), original = input.view.authoring.captureSourceReference();
	const lookup = t.mock.method(f.sources.catalog, 'resolveResource', () => undefined);
	const missing = await serializer.deserialize(value); lookup.mock.restore();
	assert.ok(missing instanceof UnavailableSceneEditorInput);
	assert.equal(missing instanceof TextEditorInput, false);
	assert.deepEqual(missing.resource, f.model.identity);
	assert.deepEqual(missing.snapshot.source, original.source);
	assert.deepEqual(missing.snapshot.subject, original.subject);
	assert.equal(missing.title, input.title); assert.equal(missing.description, input.description);
	assert.equal(f.group.openProducedEditor(() => missing), missing);
	assert.equal(f.group.model.activeTab, missing);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, true);
	const saved = JSON.parse(serializer.serialize(missing));
	assert.deepEqual(saved, missing.snapshot);
});

test('scene definition openings retain each exact tracked occurrence of a dirty source', t => {
	const f = fixture(t), document = f.documents.get(f.model);
	const ranges = document.scenes.map(scene => luaSourceRangeToTextRange(f.model.buffer, scene.range));
	const untrack = f.model.trackRanges(new Map(ranges.map((range, index) => [index, range]))); t.after(untrack);
	assert.equal(f.controller.openDefinition(f.group, f.model.resource, ranges[0]), true);
	const first = f.group.model.activeTab; assert.ok(first instanceof SceneEditorInput);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	assert.equal(f.controller.openDefinition(f.group, f.model.resource, ranges[1]), true);
	const second = f.group.model.activeTab; assert.ok(second instanceof SceneEditorInput);
	assert.notEqual(first, second); assert.equal(first.workingCopy, second.workingCopy);
	assert.equal(f.controller.openDefinition(f.group, f.model.resource, ranges[0]), true);
	assert.equal(f.group.model.activeTab, first); assert.equal(f.group.model.tabs.length, 2);
	assert.equal(f.model.dirty, true); assert.ok(f.model.buffer.getText().startsWith('-- unsaved\n'));
});
