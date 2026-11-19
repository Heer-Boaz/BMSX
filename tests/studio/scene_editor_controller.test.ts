import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { beforeEach, type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { SceneEditorNavigationSelection } from '../../ide/workbench/contrib/scene_editor/navigation_selection';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';

beforeEach(() => configureFontVariant('tiny'));

test('Scene status follows installed source independently of Save in both presentations', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const pane = f.group.panes.getPane('scene_editor'); assert.ok(pane instanceof SceneEditorPane);
	const media = f.sources.currentBlua32Media, system = media.system!;
	f.sources.currentBlua32Media = { ...media, system: { ...system, sources: new Map([...system.sources,
		['scene', { displayPath: 'scene.lua', content: { kind: 'text' as const, text: SCENE_VIEWPORT_SOURCE } }]]) } };
	f.primary.updateStatus(); pane.updateStatus();
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, f.model), 'applied');
	const installed = f.primary.statusItems[0].text;
	assert.equal(pane.statusItems[0].text, installed);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	f.primary.updateStatus(); pane.updateStatus();
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, f.model), 'pending');
	const changed = f.primary.statusItems[0].text;
	assert.notEqual(changed, installed); assert.equal(pane.statusItems[0].text, changed);
	assert.equal((await f.ide.textFileSaves.save(f.model).completion).status, 'saved');
	assert.equal(f.model.dirty, false); f.primary.updateStatus(); pane.updateStatus();
	assert.equal(f.primary.statusItems[0].text, changed); assert.equal(pane.statusItems[0].text, changed);
	f.model.undo(); f.primary.updateStatus(); pane.updateStatus();
	assert.equal(f.model.dirty, true); assert.equal(getTextFileRuntimeSourceStatus(f.sources, f.model), 'applied');
	assert.equal(f.primary.statusItems[0].text, installed); assert.equal(pane.statusItems[0].text, installed);
});

test('a shared Scene controller keeps group openings and explicit mutation subjects independent', t => {
	const sources = createScenarioTestSourceState([
		...SCENE_VIEWPORT_IMPORTS.map(([path, source]) => createScenarioTestSourceRecord(path, 1, source)),
		createScenarioTestSourceRecord('scene.lua', 1, SCENE_VIEWPORT_SOURCE),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, ''),
	]);
	const first = createTestEditorGroup(), second = createTestEditorGroup();
	const controller = new SceneEditorController(sources.catalog, new SceneSourceDocuments(editorTextModelService, sources.catalog));
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	t.after(() => {
		first.dispose(); second.dispose(); inputFocus.setTarget(null);
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	});
	controller.openResource(first, resource); controller.openResource(second, resource);
	const left = first.model.activeTab, right = second.model.activeTab;
	assert.ok(left instanceof SceneEditorInput); assert.ok(right instanceof SceneEditorInput);
	assert.notEqual(left, right); assert.equal(left.workingCopy, right.workingCopy);
	left.view.refresh(); right.view.refresh();
	assert.notEqual(left.view.authoring, right.view.authoring, 'independent document views own independent semantic selections');
	assert.equal(left.view.authoring.document, right.view.authoring.document, 'view lifetime does not duplicate shared domain topology');
	selectSceneOutlineRow(left.view.hierarchy, 1); selectSceneOutlineRow(right.view.hierarchy, 0);
	second.activate(right.id);
	const siblingRange = { ...right.view.authoring.selectionRange };
	const location = left.view.authoring.getSourceLocation();
	assert.ok(location?.model === left.workingCopy); assert.equal(location.modelVersion, left.workingCopy.version);
	assert.deepEqual(right.view.authoring.selectionRange, siblingRange);
	assert.equal(right.view.authoring.canRemoveSelectedMember(), false);
	assert.equal(left.view.authoring.canMoveSelectedMember(1), true);
	left.view.authoring.moveSelectedMember(1);
	const text = left.workingCopy.buffer.getText();
	assert.ok(text.indexOf("member_id = 'source only'") < text.indexOf("member_id = 'subject'"),
		'the explicitly supplied first view determines the move, not the active sibling');
	right.view.refresh();
	const selected = right.view.hierarchy.outline.rows[right.view.hierarchy.outline.selectionIndex].element;
	assert.equal(selected.kind, 'scene', 'the active sibling keeps its independent scene-root selection');
	assert.equal(second.model.activeTab, right);
	assert.equal(left.view.authoring.canRemoveSelectedMember(), true);
	left.view.authoring.removeSelectedMember(); left.view.refresh();
	assert.equal(left.workingCopy.buffer.getText().includes("member_id = 'subject'"), false);
	assert.equal(left.workingCopy.buffer.getText().includes("member_id = 'source only'"), true);
	assert.equal(left.view.hierarchy.outline.selectionIndex, -1);
	left.workingCopy.undo(); left.workingCopy.undo();
	assert.equal(left.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

test('Scene source location and member command retain their subject when another group gains focus', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const pane = f.group.panes.getPane('scene_editor'); assert.ok(pane instanceof SceneEditorPane);
	const target = f.primary.commandTarget, invocation = target.getCommand('sceneEditor.moveMemberDown')!.capture!()!;
	f.first.focus();
	const location = await pane.getSourceLocation();
	assert.equal(location?.model, f.model); assert.equal(location?.modelVersion, f.model.version);
	assert.equal(invocation.isEnabled(), true); invocation.run();
	assert.ok(f.model.buffer.getText().indexOf("member_id = 'source only'") < f.model.buffer.getText().indexOf("member_id = 'subject'"));
	assert.ok(f.group.openEditor(new CodeEditorInput(f.model))); f.update();
	assert.equal(invocation.isEnabled(), false);
});

function definitionOpeningFixture(t: TestContext) {
	const source = `local scenes = require('cartlib/world/scene_library')
local prefab = require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_3d')})
scenes.register('same', { objects = { { member_id = 'one', definition_id = 'actor', position = { x = 11, y = 12, z = 13 }, options = { visible = true } } } })
scenes.register('same', { objects = { { member_id = 'two', definition_id = 'actor', position = { x = 22, y = 23, z = 24 } } } })
scenes.register('incomplete', {})
`;
	const actual = createActualSourcePanes(t, false, [
		...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source],
		['unopened.lua', source.replace("prefab.define({def_id='actor',class=require('cartlib/world/object_3d')})", '')],
		['cartlib/world/scene_library.lua', ''],
	]);
	const { editor, sources } = actual, controller = editor.sceneEditor, parts = editor.editorParts;
	const group = parts.main.activeGroup;
	const resource = sources.catalog.resolveResource({ contextId: sources.systemContextId, path: 'scene.lua' })!;
	const unopened = sources.catalog.resolveResource({ contextId: resource.contextId, path: 'unopened.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	const document = actual.ide.sceneSources.get(model);
	const ranges = document.scenes.map(scene => luaSourceRangeToTextRange(model.buffer, scene.range));
	const untrack = model.trackRanges(new Map(ranges.map((range, index) => [index, range])));
	t.after(untrack);
	group.focus(); actual.update();
	return { ...actual, controller, group, parts, resource, unopened, model, ranges, source,
		get primary() { const primary = editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient); return primary; } };
}

test('Scene definition opening selects the exact table among duplicate semantic IDs and reads dirty canonical source', t => {
	const f = definitionOpeningFixture(t);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved prefix\n' }]);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[1]), true);
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	assert.equal(input.workingCopy, f.model);
	assert.equal(input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex].element.scene, input.view.authoring.document.scenes[1]);
	assert.equal(input.view.authoring.document.scenes.length, 2, 'a registration without an objects table is not an editable definition');
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	const selectedInput = f.group.model.activeTab; assert.ok(selectedInput instanceof SceneEditorInput);
	selectSceneOutlineRow(selectedInput.view.hierarchy, 1); f.update();
	assert.equal(f.primary.details.control.controls[0].field.text, '22');
	setFieldText(f.primary.details.control.controls[0].field, '123', false);
	assert.equal(f.primary.details.control.controls[0].commit(), true);
	assert.ok(f.model.buffer.getText().includes('x = 123, y = 23'));
	assert.ok(f.model.buffer.getText().includes('x = 11, y = 12'));
	f.model.undo(); f.update();
	assert.equal(f.primary.details.control.controls[0].field.text, '22');
	assert.equal(f.group.model.tabs.length, 1);
});

test('reopening the same Scene retains its reading while another occurrence is a distinct document', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const input = f.group.model.activeTab; assert.ok(input instanceof SceneEditorInput);
	selectSceneOutlineRow(input.view.hierarchy, 1); f.update();
	const history = new SceneEditorNavigationSelection(input.view); t.after(() => history.dispose());
	const subject = { ...input.view.authoring.selectionRange };
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	assert.equal(f.group.model.activeTab, input); assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[1]), true);
	const second = f.group.model.activeTab; assert.ok(second instanceof SceneEditorInput);
	assert.notEqual(second, input); assert.equal(second.workingCopy, input.workingCopy);
	assert.equal(f.group.model.tabs.length, 2);
	const restored = f.group.openEditor(input, { navigationSelection: history });
	assert.ok(restored !== undefined); assert.equal(restored.activated, true); f.update();
	assert.equal(f.primary.input, input); assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(f.primary.details.control.controls[0].field.text, '11');
});

test('Scene opening settles the attached field draft before consuming its tracked target range', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	const selectedInput = f.group.model.activeTab; assert.ok(selectedInput instanceof SceneEditorInput);
	selectSceneOutlineRow(selectedInput.view.hierarchy, 1); f.update();
	f.primary.details.control.controls[0].field.focusTarget.focus();
	setFieldText(f.primary.details.control.controls[0].field, '123456', false);
	const priorStart = f.ranges[1].start;
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[1]), true);
	assert.ok(f.ranges[1].start > priorStart, 'accepted source text moves the tracked target before it is consumed');
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	assert.deepEqual(input.view.authoring.selectionRange, f.ranges[1]);
	assert.ok(f.model.buffer.getText().includes('x = 123456, y = 12'));
	assert.equal(f.primary.details.control.controls[0].pending, false);
});

test('Scene position and option bindings reread canonical values after commit and Undo before the next update', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	const selectedInput = f.group.model.activeTab; assert.ok(selectedInput instanceof SceneEditorInput);
	selectSceneOutlineRow(selectedInput.view.hierarchy, 1); f.update();
	setFieldText(f.primary.details.control.controls[0].field, '123', false);
	assert.equal(f.primary.details.control.controls[0].commit(), true);
	f.model.undo();
	f.update();
	assert.equal(f.primary.details.control.controls[0].field.text, '11');
	const option = f.primary.details.control.options.controls[0];
	assert.ok(option.kind === 'boolean');
	assert.equal(option.focusTarget.focus(), true);
	inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none));
	inputFocus.handleKeyboard(new KeyInputEvent('Space', KeyModifier.none, false, false));
	assert.equal(f.model.buffer.getText(), f.source.replace('visible = true', 'visible = false'));
	f.model.undo();
	f.update();
	assert.equal(option.control.input!.checked, true);
	assert.equal(f.model.buffer.getText(), f.source);
});

test('invalid Scene draft admission leaves the attachment and subject intact without creating the requested document', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	const selectedInput = f.group.model.activeTab; assert.ok(selectedInput instanceof SceneEditorInput);
	selectSceneOutlineRow(selectedInput.view.hierarchy, 1); f.update();
	f.primary.details.control.controls[0].field.focusTarget.focus();
	setFieldText(f.primary.details.control.controls[0].field, '-', false);
	const subject = { ...input.view.authoring.selectionRange }, generation = f.group.panes.openGeneration;
	assert.equal(editorTextModelService.get(f.unopened), undefined);
	assert.equal(f.controller.openDefinition(f.group, f.unopened, f.ranges[1]), false);
	assert.equal(editorTextModelService.get(f.unopened), undefined);
	assert.deepEqual(f.group.model.tabs, [input]);
	assert.equal(f.parts.documents.length, 2);
	assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(f.group.panes.openGeneration, generation);
	assert.equal(f.group.panes.activePane?.input, input);
	assert.equal(inputFocus.target, f.primary.details.control.controls[0].field.focusTarget);
	assert.equal(f.primary.details.control.controls[0].pending, true);
	assert.equal(f.model.buffer.getText(), f.source);
});

for (const edit of ['delete', 'replace'] as const) test(`${edit} retires the Scene table extent instead of reopening a surviving or identically replaced namesake`, t => {
	const f = definitionOpeningFixture(t);
	const retired = f.ranges[0];
	f.model.pushEditOperations([{ offset: retired.start, deleteLength: retired.end - retired.start,
		text: edit === 'delete' ? '' : f.model.buffer.getTextRange(retired.start, retired.end) }]);
	assert.equal(retired.start, retired.end, 'complete replacement retires the actual canonical occurrence');
	assert.equal(f.controller.openDefinition(f.group, f.resource, retired), false);
	assert.equal(f.group.model.tabs.length, 0);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[1]), true);
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	const subject = { ...input.view.authoring.selectionRange };
	assert.equal(f.controller.openDefinition(f.group, f.resource, retired), false);
	assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(f.group.model.activeTab, input);
});

test('domain admission cannot hide a revoked provider generation from its retained Scene outline', t => {
	const source = SCENE_VIEWPORT_SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [...SCENE_VIEWPORT_IMPORTS, ['bridge.lua', "return require('cartlib/world/scene_library')"]]);
	const input = new SceneEditorInput(f.model, f.documents, f.sources.catalog);
	t.after(() => input.dispose());
	input.view.refresh(); selectSceneOutlineRow(input.view.hierarchy, 1);
	const displayed = input.view.hierarchy.outlineDocument, row = input.view.hierarchy.outline.rows[1];
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.model.resource.contextId, path: 'bridge.lua' })!);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	assert.equal(input.view.authoring.canRemoveSelectedMember(), false, 'the domain admits the new proof before a view update');
	assert.notEqual(input.view.authoring.document, displayed);
	assert.equal(input.view.hierarchy.outline.rows[1], row, 'the control still holds its own earlier-generation receipt');
	assert.equal(selectSceneOutlineRow(input.view.hierarchy, 1), false, 'old rows cannot borrow the newly admitted document as their proof');
	input.view.refresh();
	assert.equal(input.view.hierarchy.outlineDocument, input.view.authoring.document);
	assert.equal(input.view.hierarchy.outline.rows.length, 0);
	assert.equal(input.view.hierarchy.outline.selectionIndex, -1);
	assert.equal(input.view.details.properties.length, 0);
	assert.equal(f.model.buffer.getText(), source);
});

test('same-byte replacement retires a row receipt even when its source projection is reused', t => {
	const f = createSceneSourceFixture(t, SCENE_VIEWPORT_SOURCE, 'scene.lua', undefined, SCENE_VIEWPORT_IMPORTS), input = new SceneEditorInput(f.model, f.documents, f.sources.catalog);
	t.after(() => input.dispose());
	input.view.refresh(); selectSceneOutlineRow(input.view.hierarchy, 1);
	const displayed = input.view.hierarchy.outlineDocument, row = input.view.hierarchy.outline.rows[1], version = input.view.hierarchy.outlineSourceVersion;
	const { start, end } = input.view.authoring.selectionRange;
	f.model.pushEditOperations([{ offset: start, deleteLength: end - start, text: f.model.buffer.getTextRange(start, end) }]);
	assert.equal(input.view.authoring.selection, undefined);
	assert.equal(input.view.authoring.document, displayed, 'identical source retains the shared immutable projection');
	assert.notEqual(f.model.version, version);
	assert.equal(selectSceneOutlineRow(input.view.hierarchy, 1), false, 'an old version cannot reselect a replaced occurrence from identical AST data');
	input.view.refresh();
	assert.notEqual(input.view.hierarchy.outline.rows[1], row);
	assert.equal(input.view.hierarchy.outline.selectionIndex, -1);
	assert.equal(input.view.details.properties.length, 0);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

test('Scene removal projects rather than clears a newer source selection from its publication callback', t => {
	const f = definitionOpeningFixture(t);
	f.controller.openDefinition(f.group, f.resource, f.ranges[0]);
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	selectSceneOutlineRow(input.view.hierarchy, 1);
	const release = f.model.onDidChangeContent(() => {
		release();
		const document = f.controller.documents.get(f.model);
		input.view.authoring.select(document, f.model.version, { kind: 'scene', scene: document.scenes[0] });
	});
	t.after(release);
	input.view.authoring.removeSelectedMember(); input.view.refresh();
	const selected = input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex].element;
	assert.equal(selected.kind, 'scene');
	assert.equal(selected.scene, input.view.authoring.document!.scenes[0]);
	assert.equal(input.view.authoring.selection?.scene, selected.scene);
	assert.equal(input.view.details.properties.length, 0);
});
