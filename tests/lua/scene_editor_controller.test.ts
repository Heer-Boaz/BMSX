import { MainWorkspace } from '../../ide/workbench/main_workspace';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { measureSceneEditor } from '../../ide/workbench/contrib/scene_editor/layout';
import { EditorParts } from '../../ide/workbench/services/editor/editor_parts';
import { beforeEach, type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestEditorGroup, createTestEditorPaneContributions, createTestEditorCloseDependencies, createTestGroupPresentation } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { pointerCapture } from '../../ide/input/pointer/capture';
import type { IdeCommandController } from '../../ide/commands/controller';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { buildSceneSourceDocument } from '../../ide/workbench/contrib/scene_editor/source';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { SceneEditorNavigationSelection } from '../../ide/workbench/contrib/scene_editor/navigation_selection';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { createSceneSourceFixture } from '../helpers/scene_sources';

beforeEach(() => configureFontVariant('tiny'));

test('a shared Scene controller keeps group openings and explicit mutation subjects independent', t => {
	const sources = createScenarioTestSourceState([
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

test('Scene pane source production and member commands retain their input when another group gains focus', async t => {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('scene.lua', 1, SCENE_VIEWPORT_SOURCE),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, ''),
	]);
	const controller = new SceneEditorController(sources.catalog, new SceneSourceDocuments(editorTextModelService, sources.catalog));
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const menu = new ContextMenuController(inputFocus, pointerCapture), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 0, top: 0, right: 384, bottom: 288 }, presentation = createTestGroupPresentation(surfaces, bounds);
	const main = new MainWorkspace(surfaces, presentation.owner, presentation.focusScope, commands,
		() => parts.main.layout(main.documentBounds), () => parts.activate(parts.main, main),
		focus => { if (focus) parts.main.focus(); else parts.activate(parts.main); }, () => parts.main.activeGroup); main.layout(bounds);
	let parts: EditorParts;
	const contributions = createTestEditorPaneContributions(commands, menu);
	contributions.scene_editor = { create: group => new SceneEditorPane(commands as IdeCommandController, sources, menu,
		surfaces, group.paneSurface, bounds, group.focusScope), measure: measureSceneEditor };
	parts = new EditorParts({ surfaces, owner: presentation.owner, scope: presentation.focusScope, workArea: bounds, mainPresentation: main,
		commands, contextMenu: menu, renderContext: presentation.renderContext, contributions,
		focusReturn: inputFocus.createTarget(null, presentation.focusScope),
		layoutMain: () => parts.main.layout(bounds),
		...createTestEditorCloseDependencies(t, presentation),
	});
	const first = parts.main.activeGroup, second = parts.createDocument({ requestedBounds: bounds }).activeGroup;
	first.panes.layout(bounds);
	controller.openResource(first, resource); controller.openResource(second, resource);
	const left = first.model.activeTab, right = second.model.activeTab;
	assert.ok(left instanceof SceneEditorInput); assert.ok(right instanceof SceneEditorInput);
	left.view.refresh(); right.view.refresh();
	selectSceneOutlineRow(left.view.hierarchy, 0); selectSceneOutlineRow(right.view.hierarchy, 1);
	const pane = second.panes.getPane('scene_editor')!;
	t.after(() => {
		parts.dispose(); menu.dispose(); surfaces.dispose(); inputFocus.setTarget(null);
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	});
	pane.update(0); pane.focus();
	const origin = inputFocus.target!;
	first.activate(left.id);
	const location = await pane.getSourceLocation!();
	assert.ok(location?.model === right.workingCopy); assert.equal(location.modelVersion, right.workingCopy.version);
	assert.equal(origin.commandContext.getCommand('sceneEditor.moveMemberDown')!.isEnabled(), true);
	inputFocus.executeCommand('sceneEditor.moveMemberDown', origin.commandContext);
	assert.ok(right.workingCopy.buffer.getText().indexOf("member_id = 'source only'") < right.workingCopy.buffer.getText().indexOf("member_id = 'subject'"));
	left.view.refresh();
	assert.equal(left.view.hierarchy.outline.rows[left.view.hierarchy.outline.selectionIndex].element.kind, 'scene');
	second.panes.clearEditor();
	assert.equal(origin.commandContext.getCommand('sceneEditor.removeMember')!.isEnabled(), false, 'a detached pane no longer admits its former subject');
});

function definitionOpeningFixture(t: TestContext, height = 288) {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = { { member_id = 'one', definition_id = 'actor', options = { visible = true, pos = { x = 11, y = 12, z = 13 } } } } })
scenes.register('same', { objects = { { member_id = 'two', definition_id = 'actor', options = { pos = { x = 22, y = 23, z = 24 } } } } })
scenes.register('incomplete', {})
`;
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('scene.lua', 1, source),
		createScenarioTestSourceRecord('unopened.lua', 1, source),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, ''),
	]);
	const controller = new SceneEditorController(sources.catalog, new SceneSourceDocuments(editorTextModelService, sources.catalog));
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const menu = new ContextMenuController(inputFocus, pointerCapture), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 0, top: 0, right: 384, bottom: height }, presentation = createTestGroupPresentation(surfaces, bounds);
	const main = new MainWorkspace(surfaces, presentation.owner, presentation.focusScope, commands,
		() => parts.main.layout(main.documentBounds), () => parts.activate(parts.main, main),
		focus => { if (focus) parts.main.focus(); else parts.activate(parts.main); }, () => parts.main.activeGroup); main.layout(bounds);
	let parts: EditorParts;
	const contributions = createTestEditorPaneContributions(commands, menu);
	contributions.scene_editor = { create: group => new SceneEditorPane(commands as IdeCommandController, sources, menu,
		surfaces, group.paneSurface, bounds, group.focusScope), measure: measureSceneEditor };
	parts = new EditorParts({ surfaces, owner: presentation.owner, scope: presentation.focusScope, workArea: bounds, mainPresentation: main,
		commands, contextMenu: menu, renderContext: presentation.renderContext, contributions,
		focusReturn: inputFocus.createTarget(null, presentation.focusScope),
		layoutMain: () => parts.main.layout(bounds),
		...createTestEditorCloseDependencies(t, presentation),
	});
	const group = parts.main.activeGroup;
	group.panes.layout(bounds);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	const unopened = sources.catalog.resolveResource({ contextId: resource.contextId, path: 'unopened.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId);
	project.synchronizeSources(sources.catalog);
	const document = buildSceneSourceDocument(resource, project.getSnapshot());
	const ranges = document.scenes.map(scene => luaSourceRangeToTextRange(model.buffer, scene.range));
	const untrack = model.trackRanges(new Map(ranges.map((range, index) => [index, range])));
	t.after(() => {
		const pane = group.panes.getPane('scene_editor');
		if (pane instanceof SceneEditorPane) for (const control of pane.control.details.controls) control.cancel();
		parts.dispose(); menu.dispose(); surfaces.dispose(); untrack(); inputFocus.setTarget(null);
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	});
	return { controller, group, parts, resource, unopened, model, ranges, source };
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
	pane.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	assert.equal(pane.control.details.controls[0].field.text, '22');
	setFieldText(pane.control.details.controls[0].field, '123', false);
	assert.equal(pane.control.details.controls[0].commit(), true);
	assert.ok(f.model.buffer.getText().includes('x = 123, y = 23'));
	assert.ok(f.model.buffer.getText().includes('x = 11, y = 12'));
	f.model.undo(); pane.update();
	assert.equal(pane.control.details.controls[0].field.text, '22');
	assert.equal(f.group.model.tabs.length, 1);
});

test('reopening a surviving Scene occurrence keeps its subject and reading; explicit switches and history rebind controls', t => {
	const f = definitionOpeningFixture(t, 90);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	pane.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	const history = new SceneEditorNavigationSelection(input.view);
	t.after(() => history.dispose());
	pane.control.details.controls[0].field.focusTarget.focus();
	input.view.details.viewport.scrollbar.setScroll(17);
	const subject = { ...input.view.authoring.selectionRange }, scroll = input.view.details.viewport.scrollTop;
	assert.ok(scroll > 0, 'the retained Details reading position is not its initial top');
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(input.view.section, 'details');
	assert.equal(input.view.details.viewport.scrollTop, scroll);
	assert.equal(pane.control.details.controls[0].field.text, '11');
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[1]), true);
	assert.equal(input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex].element.scene, input.view.authoring.document.scenes[1]);
	assert.equal(pane.control.details.controls[0].field.readOnly, true, 'switching to a definition retires the former member control subject');
	const restored = f.group.openEditor(input, { navigationSelection: history });
	assert.ok(restored !== undefined); assert.equal(restored.activated, true); assert.equal(restored.generation, f.group.panes.openGeneration);
	assert.equal(pane.control.details.controls[0].field.readOnly, false);
	assert.equal(pane.control.details.controls[0].field.text, '11', 'history restoration rebinds the retained member before accepting another field draft');
	assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(f.group.model.tabs.length, 1);
});

test('Scene opening settles the attached field draft before consuming its tracked target range', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	pane.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	pane.control.details.controls[0].field.focusTarget.focus();
	setFieldText(pane.control.details.controls[0].field, '123456', false);
	const priorStart = f.ranges[1].start;
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[1]), true);
	assert.ok(f.ranges[1].start > priorStart, 'accepted source text moves the tracked target before it is consumed');
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	assert.deepEqual(input.view.authoring.selectionRange, f.ranges[1]);
	assert.ok(f.model.buffer.getText().includes('x = 123456, y = 12'));
	assert.equal(pane.control.details.controls[0].pending, false);
});

test('Scene position and option bindings reread canonical values after commit and Undo before the next update', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	pane.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	setFieldText(pane.control.details.controls[0].field, '123', false);
	assert.equal(pane.control.details.controls[0].commit(), true);
	f.model.undo();
	pane.update();
	assert.equal(pane.control.details.controls[0].field.text, '11');
	const option = pane.control.details.options.controls[0];
	setFieldText(option.field, 'false', false);
	assert.equal(option.commit(), true);
	f.model.undo();
	pane.update();
	assert.equal(option.field.text, 'true');
	assert.equal(f.model.buffer.getText(), f.source);
});

test('invalid Scene draft admission leaves the attachment and subject intact without creating the requested document', t => {
	const f = definitionOpeningFixture(t);
	assert.equal(f.controller.openDefinition(f.group, f.resource, f.ranges[0]), true);
	const input = f.group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	const pane = f.group.panes.getPane('scene_editor')!;
	assert.ok(pane instanceof SceneEditorPane);
	pane.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	pane.control.details.controls[0].field.focusTarget.focus();
	setFieldText(pane.control.details.controls[0].field, '-', false);
	const subject = { ...input.view.authoring.selectionRange }, generation = f.group.panes.openGeneration;
	assert.equal(editorTextModelService.get(f.unopened), undefined);
	assert.equal(f.controller.openDefinition(f.group, f.unopened, f.ranges[1]), false);
	assert.equal(editorTextModelService.get(f.unopened), undefined);
	assert.deepEqual(f.group.model.tabs, [input]);
	assert.equal(f.parts.documents.length, 0);
	assert.deepEqual(input.view.authoring.selectionRange, subject);
	assert.equal(f.group.panes.openGeneration, generation);
	assert.equal(f.group.panes.activePane?.input, input);
	assert.equal(inputFocus.target, pane.control.details.controls[0].field.focusTarget);
	assert.equal(pane.control.details.controls[0].pending, true);
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
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['bridge.lua', "return require('cartlib/world/scene_library')"]]);
	const input = new SceneEditorInput(f.model, f.documents);
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
	assert.ok(input.view.details.properties.every(property => property.descriptor.field === null));
	assert.equal(f.model.buffer.getText(), source);
});

test('same-byte replacement retires a row receipt even when its source projection is reused', t => {
	const f = createSceneSourceFixture(t, SCENE_VIEWPORT_SOURCE), input = new SceneEditorInput(f.model, f.documents);
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
	assert.ok(input.view.details.properties.every(property => property.descriptor.field === null));
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
		input.view.authoring.select(document, f.model.version, { kind: 'scene', scene: document.scenes[1] });
	});
	t.after(release);
	input.view.authoring.removeSelectedMember(); input.view.refresh();
	const selected = input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex].element;
	assert.equal(selected.kind, 'scene');
	assert.equal(selected.scene, input.view.authoring.document!.scenes[1]);
	assert.equal(input.view.authoring.selection?.scene, selected.scene);
	assert.ok(input.view.details.properties.every(property => property.descriptor.field === null));
});
