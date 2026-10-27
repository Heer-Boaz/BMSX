import { EditorParts } from '../../ide/workbench/services/editor/editor_parts';
import { beforeEach } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import type { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestEditorGroup, createTestEditorPaneFactories, createTestGroupPresentation } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { pointerCapture } from '../../ide/input/pointer/capture';
import type { IdeCommandController } from '../../ide/commands/controller';
import type { EditorCommandRunner } from '../../ide/common/commands';

beforeEach(() => configureFontVariant('tiny'));

test('a shared Scene controller keeps group openings and explicit mutation subjects independent', t => {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('scene.lua', 1, SCENE_VIEWPORT_SOURCE),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, ''),
	]);
	const first = createTestEditorGroup(), second = createTestEditorGroup();
	const opened: Parameters<EditorNavigationController['focusChunkSource']>[] = [];
	const navigation = { focusChunkSource: (...args: Parameters<EditorNavigationController['focusChunkSource']>) => {
		opened.push(args); return Promise.resolve(undefined);
	} } as EditorNavigationController;
	const controller = new SceneEditorController(sources.catalog, navigation);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	t.after(() => {
		first.dispose(); second.dispose(); inputFocus.setTarget(null);
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	});
	controller.openResource(first, resource); controller.openResource(second, resource);
	const left = first.model.activeTab, right = second.model.activeTab;
	assert.ok(left instanceof SceneEditorInput); assert.ok(right instanceof SceneEditorInput);
	assert.notEqual(left, right); assert.equal(left.workingCopy, right.workingCopy);
	controller.refresh(left); controller.refresh(right);
	selectSceneOutlineRow(left, 1); selectSceneOutlineRow(right, 0);
	second.activate(right.id);
	const siblingRange = { ...right.selectionRange };
	controller.openSource(first, left);
	assert.equal(opened[0][0], first); assert.deepEqual(opened[0][1], resource);
	assert.deepEqual(right.selectionRange, siblingRange);
	assert.equal(controller.canRemoveSelectedMember(right), false);
	assert.equal(controller.canMoveSelectedMember(left, 1), true);
	controller.moveSelectedMember(left, 1);
	const text = left.workingCopy.buffer.getText();
	assert.ok(text.indexOf("member_id = 'source only'") < text.indexOf("member_id = 'subject'"),
		'the explicitly supplied first view determines the move, not the active sibling');
	controller.refresh(right);
	const selected = right.outline.rows[right.outline.selectionIndex].element;
	assert.equal(selected.kind, 'scene', 'the active sibling keeps its independent scene-root selection');
	assert.equal(second.model.activeTab, right);
	assert.equal(controller.canRemoveSelectedMember(left), true);
	controller.removeSelectedMember(left);
	assert.equal(left.workingCopy.buffer.getText().includes("member_id = 'subject'"), false);
	assert.equal(left.workingCopy.buffer.getText().includes("member_id = 'source only'"), true);
	assert.equal(left.outline.selectionIndex, -1);
	left.workingCopy.undo(); left.workingCopy.undo();
	assert.equal(left.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

test('Scene pane Source and member commands retain their group and input when another group gains focus', t => {
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('scene.lua', 1, SCENE_VIEWPORT_SOURCE),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, ''),
	]);
	const opened: Parameters<EditorNavigationController['focusChunkSource']>[] = [];
	const navigation = { focusChunkSource: (...args: Parameters<EditorNavigationController['focusChunkSource']>) => {
		opened.push(args); return Promise.resolve(undefined);
	} } as EditorNavigationController;
	const controller = new SceneEditorController(sources.catalog, navigation);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const menu = new ContextMenuController(inputFocus, pointerCapture), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 0, top: 0, right: 384, bottom: 288 }, presentation = createTestGroupPresentation(surfaces, bounds);
	let parts: EditorParts;
	const factories = createTestEditorPaneFactories();
	factories.scene_editor = group => new SceneEditorPane(controller, commands as IdeCommandController, sources, menu,
		surfaces, group.paneSurface, bounds, group, parts, group.focusScope);
	parts = new EditorParts({ surfaces, owner: presentation.owner, scope: presentation.focusScope, workArea: bounds,
		commands, contextMenu: menu, renderContext: presentation.renderContext, factories,
		focusReturn: inputFocus.createTarget(null, presentation.focusScope),
		layoutMain: () => parts.main.layoutMain(bounds, bounds),
		closeEditors: async targets => { for (const target of targets) target.group.removeEditor(target.input); return true; },
	});
	const first = parts.main.group, second = parts.createDocument(bounds).group;
	first.panes.layout(bounds);
	controller.openResource(first, resource); controller.openResource(second, resource);
	const left = first.model.activeTab, right = second.model.activeTab;
	assert.ok(left instanceof SceneEditorInput); assert.ok(right instanceof SceneEditorInput);
	controller.refresh(left); controller.refresh(right);
	selectSceneOutlineRow(left, 0); selectSceneOutlineRow(right, 1);
	const pane = second.panes.getPane('scene_editor')!;
	t.after(() => {
		parts.dispose(); menu.dispose(); surfaces.dispose(); inputFocus.setTarget(null);
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
	});
	pane.update(0); pane.focus();
	const origin = inputFocus.target!;
	first.activate(left.id);
	inputFocus.executeCommand('sceneEditor.source', origin);
	assert.equal(opened[0][0], second); assert.deepEqual(opened[0][1], resource);
	assert.equal(origin.getCommand('sceneEditor.moveMemberDown')!.isEnabled(), true);
	inputFocus.executeCommand('sceneEditor.moveMemberDown', origin);
	assert.ok(right.workingCopy.buffer.getText().indexOf("member_id = 'source only'") < right.workingCopy.buffer.getText().indexOf("member_id = 'subject'"));
	controller.refresh(left);
	assert.equal(left.outline.rows[left.outline.selectionIndex].element.kind, 'scene');
	second.panes.clearEditor();
	assert.equal(origin.getCommand('sceneEditor.removeMember')!.isEnabled(), false, 'a detached pane no longer admits its former subject');
});
