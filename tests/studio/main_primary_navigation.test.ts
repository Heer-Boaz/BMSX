import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first' },
 { member_id = 'same', definition_id = 'second' },
} })
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'other' },
} })`;

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['other-scene.lua', SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const copy = model('scene.lua'), other = model('other-scene.lua'), main = f.editor.mainWorkspace, parts = f.editor.editorParts;
	const open = (index: number, workingCopy = copy) => {
		const document = f.ide.sceneSources.get(workingCopy);
		return f.editor.openSceneInMain(() => ({ model: workingCopy, subject: { document, sourceVersion: workingCopy.version, scene: document.scenes[index] } }), inputFocus.target!);
	};
	f.first.focus(); resetNavigationHistoryState();
	return { ...f, copy, other, main, parts, open };
}

test('Scene and Source share Back/Forward while retaining their real document inputs', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 2), true); f.update();
	const scene = first.input, sceneGroup = f.parts.findGroup(scene)!; resetNavigationHistoryState();
	await f.editor.navigation.openResource(sceneGroup, f.copy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const source = sceneGroup.model.activeTab; assert.ok(source?.kind === 'code_editor');
	assert.ok(sceneGroup.model.contains(scene)); assert.equal(navigationState.back.length, 1);
	assert.equal(navigationState.back[0].target.kind, 'location');
	await f.editor.navigation.goBackward(); f.update();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.equal(restored.input, scene); assert.equal(sceneGroup.model.activeTab, scene);
	const selected = restored.authoring.selection; assert.ok(selected?.kind === 'member');
	assert.ok(selected.scene === restored.authoring.document!.scenes[0] && selected.entry === selected.scene.objects[1]);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 1);
	await f.editor.navigation.goForward(); f.update();
	assert.equal(sceneGroup.model.activeTab, source); assert.ok(sceneGroup.model.contains(scene));
	assert.equal(navigationState.back.length, 1); assert.equal(navigationState.forward.length, 0);
	assert.equal(f.copy.buffer.getText(), SOURCE); assert.equal(f.copy.dirty, false);
});

test('Scene history restores exact same-named declarations and member selections after canonical movement', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 2), true); f.update();
	const firstInput = first.input; resetNavigationHistoryState();
	assert.equal(await f.open(1), true); f.update();
	const second = f.main.primary; assert.ok(second instanceof ScenePrimaryClient); const secondInput = second.input;
	const prefix = '-- edit before both namesake declarations\n';
	f.copy.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]); f.update();
	await f.editor.navigation.goBackward(); f.update();
	const previous = f.main.primary; assert.ok(previous instanceof ScenePrimaryClient);
	assert.equal(previous.input, firstInput); assert.ok(previous.authoring.subject === previous.authoring.document!.scenes[0]);
	const selected = previous.authoring.selection; assert.ok(selected?.kind === 'member');
	assert.ok(selected.entry === previous.authoring.subject!.objects[1]);
	await f.editor.navigation.goForward(); f.update();
	const forward = f.main.primary; assert.ok(forward instanceof ScenePrimaryClient);
	assert.equal(forward.input, secondInput); assert.ok(forward.authoring.subject === forward.authoring.document!.scenes[1]);
	assert.equal(f.copy.buffer.getText(), prefix + SOURCE); assert.equal(f.copy.dirty, true);
});

test('dirty cross-file Scene history retains both documents without a close decision', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); const first = f.main.primary!.input;
	resetNavigationHistoryState(); assert.equal(await f.open(0, f.other), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	f.other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained current edits\n' }]); f.update();
	const source = f.other.buffer.getText(), group = f.parts.findGroup(current.input)!;
	await f.editor.navigation.goBackward(); f.update();
	assert.ok(f.main.primary?.input === first); assert.ok(group.model.contains(current.input));
	assert.equal(f.parts.main.actionPrompt.visible, false); assert.equal(f.other.buffer.getText(), source); assert.equal(f.other.dirty, true);
	await f.editor.navigation.goForward(); f.update();
	assert.ok(f.main.primary?.input === current.input); assert.ok(group.model.contains(first));
});

test('deleting a bookmarked Scene retires that destination rather than selecting its remaining namesake', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true);
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	const reference = first.authoring.captureSourceReference().subject!; resetNavigationHistoryState();
	assert.equal(await f.open(1), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	const target = navigationState.back[0]; assert.equal(target.target.kind, 'location');
	f.copy.pushEditOperations([{ offset: reference.range.start, deleteLength: reference.range.end - reference.range.start, text: '{}' }]); f.update();
	assert.equal(target.isDisposed, true); assert.equal(navigationState.back.length, 0);
	assert.ok(f.main.primary === current && current.authoring.subject === current.authoring.document!.scenes[0]);
	assert.equal(current.authoring.availability, 'available');
	f.copy.undo(); f.update(); await f.editor.navigation.goBackward();
	assert.equal(navigationState.back.length, 0);
	assert.ok(f.main.primary === current && current.authoring.subject === current.authoring.document!.scenes[1]);
	assert.equal(f.copy.buffer.getText(), SOURCE);
});

test('Scene navigation ownership survives Files focus and background document movement and close', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(current.view.hierarchy, 1), true); const selected = current.authoring.selection;
	const group = f.parts.findGroup(current.input)!; resetNavigationHistoryState();
	f.editor.resourcePanel.show(); f.update();
	assert.ok(inputFocus.target === f.editor.resourcePanel.focusTarget && navigationState.activeOwner === group);
	assert.equal(f.parts.moveGroup(f.firstGroup, { kind: 'group', group: f.secondGroup }), true);
	assert.equal(await f.parts.close(f.secondPart), true);
	assert.ok(navigationState.activeOwner === group && f.parts.activePart === f.parts.main);
	assert.ok(inputFocus.target === f.editor.resourcePanel.focusTarget && f.main.primary === current);
	assert.ok(current.authoring.selection === selected && current.authoring.subject === current.authoring.document!.scenes[1]);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 0);
});

test('history follows a Source document between exact Scene subjects in different groups', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary!.input; resetNavigationHistoryState();
	await f.editor.navigation.openResource(f.firstGroup, f.firstInput.workingCopy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	f.editor.resourcePanel.show(); f.update();
	assert.ok(navigationState.activeOwner === f.firstGroup && inputFocus.target === f.editor.resourcePanel.focusTarget);
	assert.equal(await f.open(1), true); f.update();
	const second = f.main.primary; assert.ok(second instanceof ScenePrimaryClient);
	await f.editor.navigation.goBackward(); f.update();
	assert.ok(f.main.primary === second && navigationState.activeOwner === f.firstGroup);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	await f.editor.navigation.goBackward(); f.update();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.equal(restored.input, first); assert.ok(restored.authoring.subject === restored.authoring.document!.scenes[0]);
});

test('an inert closed-Scene bookmark cannot suppress a dirty Source last-consumer decision', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); const first = f.main.primary!.input;
	resetNavigationHistoryState(); assert.equal(await f.open(0, f.other), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	const bookmarked = navigationState.back[0]; assert.equal(bookmarked.target.kind, 'location');
	const sceneGroup = f.parts.findGroup(first)!; assert.equal(await sceneGroup.close(first.id), true);
	assert.equal(bookmarked.isDisposed, false);
	await f.editor.navigation.openResource(f.firstGroup, f.copy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const input = f.firstGroup.model.activeTab; assert.ok(input?.kind === 'code_editor');
	f.copy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- Source is the last real consumer\n' }]); f.update();
	const source = f.copy.buffer.getText(), closing = f.firstGroup.close(input.id);
	assert.equal(f.firstPart.actionPrompt.visible, true);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(f.firstGroup.model.contains(input)); assert.equal(bookmarked.isDisposed, false);
	assert.equal(f.copy.buffer.getText(), source); assert.equal(f.copy.dirty, true);
});

test('closing a focused Scene preserves its history destination and the retained Source document', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const scene = f.main.primary!.input, group = f.parts.findGroup(scene)!;
	await f.editor.navigation.openResource(group, f.copy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const source = group.model.activeTab; assert.ok(source?.kind === 'code_editor');
	assert.ok(group.openEditor(scene)); f.update(); resetNavigationHistoryState();
	assert.equal(await group.close(scene.id), true); f.update();
	assert.equal(group.model.activeTab, source); assert.equal(f.main.primary, undefined);
	assert.ok(inputFocus.admittedTarget !== null && group.focusScope.contains(inputFocus.admittedTarget.scope));
	assert.equal(navigationState.back.length, 1); assert.equal(navigationState.back[0].target.kind, 'location');
	await f.editor.navigation.goBackward(); f.update();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.ok(restored.authoring.subject === restored.authoring.document!.scenes[0]);
	assert.ok(group.model.contains(source));
});

test('a newer document focus during outgoing Scene companion retirement is not stolen by the incoming document', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	const dispose = first.dispose.bind(first);
	t.mock.method(first, 'dispose', () => { dispose(); f.second.focus(); });
	assert.equal(await f.open(1), false);
	assert.equal(f.main.primary, undefined);
	const documents = f.parts.groups.flatMap(group => group.model.tabs).filter(input => input instanceof SceneEditorInput);
	assert.equal(documents.length, 2);
	assert.ok(documents.some(input => input.view.authoring.subject === input.view.authoring.document!.scenes[1]));
	assert.ok(inputFocus.admittedTarget !== null && f.secondPart.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(f.parts.activePart === f.secondPart && navigationState.activeOwner === f.secondGroup);
});
