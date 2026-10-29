import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
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

test('Main and Source share Back/Forward without moving the retained primary into a document tab', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 2), true); first.hierarchy.update(); first.details.update();
	resetNavigationHistoryState();
	const group = f.parts.main.activeGroup;
	await f.editor.navigation.openResource(group, f.copy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	assert.ok(navigationState.activeOwner === group && f.main.primary === first);
	assert.equal(navigationState.back.length, 1); assert.equal(navigationState.back[0].target.kind, 'primary');
	await f.editor.navigation.goBackward();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient && restored !== first);
	assert.ok(navigationState.activeOwner === f.main);
	assert.ok(inputFocus.admittedTarget !== null && restored.scope.contains(inputFocus.admittedTarget.scope));
	const selected = restored.consumer.selection; assert.ok(selected?.kind === 'member');
	assert.ok(selected.scene === restored.consumer.document!.scenes[0] && selected.entry === selected.scene.objects[1]);
	assert.equal(first.consumer.isCurrent, false); assert.equal(first.hierarchy.control.hasView, false); assert.equal(first.details.control.hasView, false);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 1);
	await f.editor.navigation.goForward();
	assert.ok(navigationState.activeOwner === group && f.main.primary === restored);
	assert.ok(group.model.activeTab?.kind === 'code_editor' && group.model.activeTab.workingCopy === f.copy);
	assert.equal(navigationState.back.length, 1); assert.equal(navigationState.forward.length, 0);
	assert.ok(f.parts.groups.every(group => group.model.tabs.every(input => input.kind !== 'scene_editor')));
	assert.equal(f.copy.buffer.getText(), SOURCE); assert.equal(f.copy.dirty, false);
});

test('Main history restores exact same-named declarations and member selections after canonical movement', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 2), true); first.hierarchy.update(); first.details.update();
	resetNavigationHistoryState();
	assert.equal(await f.open(1), true); f.update();
	const second = f.main.primary; assert.ok(second instanceof ScenePrimaryClient && second !== first);
	const prefix = '-- edit before both namesake declarations\n';
	f.copy.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]); f.update();
	await f.editor.navigation.goBackward();
	const previous = f.main.primary; assert.ok(previous instanceof ScenePrimaryClient && previous !== first);
	assert.ok(previous.consumer.subject === previous.consumer.document!.scenes[0]);
	const selected = previous.consumer.selection; assert.ok(selected?.kind === 'member');
	assert.ok(selected.entry === previous.consumer.subject!.objects[1]);
	assert.equal(first.consumer.isCurrent, false); assert.equal(second.consumer.isCurrent, false);
	await f.editor.navigation.goForward();
	const forward = f.main.primary; assert.ok(forward instanceof ScenePrimaryClient && forward !== second);
	assert.ok(forward.consumer.subject === forward.consumer.document!.scenes[1]);
	assert.ok(navigationState.activeOwner === f.main);
	assert.equal(f.copy.buffer.getText(), prefix + SOURCE); assert.equal(f.copy.dirty, true);
});

test('document history never replaces the Main subject until the destination explicitly targets Main', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); resetNavigationHistoryState();
	await f.editor.navigation.openResource(f.firstGroup, f.firstInput.workingCopy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	f.editor.resourcePanel.show(); f.update();
	assert.ok(navigationState.activeOwner === f.firstGroup && inputFocus.target === f.editor.resourcePanel.focusTarget);
	assert.equal(await f.open(1), true); f.update();
	const second = f.main.primary; assert.ok(second instanceof ScenePrimaryClient);
	assert.equal(navigationState.back.length, 2);
	await f.editor.navigation.goBackward();
	assert.ok(f.main.primary === second && navigationState.activeOwner === f.firstGroup);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	await f.editor.navigation.goBackward();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient && restored !== second);
	assert.ok(navigationState.activeOwner === f.main && restored.consumer.subject === restored.consumer.document!.scenes[0]);
});

test('Cancel of a dirty cross-file primary history replacement leaves its destination and both stacks unchanged', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); resetNavigationHistoryState();
	assert.equal(await f.open(0, f.other), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	f.other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained current edits\n' }]); f.update();
	const source = f.other.buffer.getText(), back = [...navigationState.back], forward = [...navigationState.forward];
	const pending = f.editor.navigation.goBackward();
	assert.ok(f.main.primary === current);
	f.key('Escape'); await pending;
	assert.ok(f.main.primary === current && current.hierarchy.control.hasView && current.details.control.hasView && current.consumer.isCurrent);
	assert.equal(navigationState.back.length, back.length);
	assert.ok(navigationState.back.every((entry, index) => entry === back[index] && !entry.isDisposed));
	assert.equal(navigationState.forward.length, forward.length);
	assert.ok(navigationState.forward.every((entry, index) => entry === forward[index]));
	assert.ok(navigationState.activeOwner === f.main);
	assert.equal(f.other.buffer.getText(), source); assert.equal(f.other.dirty, true);
});

test('deleting a bookmarked Scene retires that destination rather than selecting its remaining namesake', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true);
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	const reference = first.consumer.captureSourceReference().subject!; resetNavigationHistoryState();
	assert.equal(await f.open(1), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	const target = navigationState.back[0]; assert.equal(target.target.kind, 'primary');
	f.copy.pushEditOperations([{ offset: reference.range.start, deleteLength: reference.range.end - reference.range.start, text: '{}' }]); f.update();
	assert.equal(target.isDisposed, true); assert.equal(navigationState.back.length, 0);
	assert.ok(f.main.primary === current && current.consumer.subject === current.consumer.document!.scenes[0]);
	assert.equal(current.consumer.availability, 'available');
	f.copy.undo(); f.update();
	await f.editor.navigation.goBackward();
	assert.equal(navigationState.back.length, 0);
	assert.ok(f.main.primary === current && current.consumer.subject === current.consumer.document!.scenes[1]);
	assert.equal(f.copy.buffer.getText(), SOURCE);
});

test('a retained history bookmark cannot suppress a dirty Source last-consumer decision', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); resetNavigationHistoryState();
	assert.equal(await f.open(0, f.other), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	const bookmarked = navigationState.back[0]; assert.equal(bookmarked.target.kind, 'primary');
	const group = f.parts.main.activeGroup;
	await f.editor.navigation.openResource(group, f.copy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const input = group.model.activeTab; assert.ok(input?.kind === 'code_editor');
	f.copy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- Source is the last real consumer\n' }]); f.update();
	const source = f.copy.buffer.getText(), closing = group.close(input.id);
	assert.equal(f.parts.main.actionPrompt.visible, true);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(group.model.contains(input) && f.main.primary === current);
	assert.equal(bookmarked.isDisposed, false);
	assert.equal(f.copy.buffer.getText(), source); assert.equal(f.copy.dirty, true);
});

test('actual Main navigation ownership survives Files focus and background document movement and close', async t => {
	const f = fixture(t); assert.equal(await f.open(1), true); f.update();
	const current = f.main.primary; assert.ok(current instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(current.view.hierarchy, 1), true); const selected = current.consumer.selection;
	resetNavigationHistoryState();
	f.editor.resourcePanel.show(); f.update();
	assert.ok(inputFocus.target === f.editor.resourcePanel.focusTarget && navigationState.activeOwner === f.main);
	assert.equal(f.parts.moveGroup(f.firstGroup, { kind: 'group', group: f.secondGroup }), true);
	assert.equal(await f.parts.close(f.secondPart), true);
	assert.ok(navigationState.activeOwner === f.main && f.parts.activePart === f.parts.main);
	assert.ok(inputFocus.target === f.editor.resourcePanel.focusTarget && f.main.primary === current);
	assert.ok(current.consumer.selection === selected && current.consumer.subject === current.consumer.document!.scenes[1]);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 0);
});

test('clearing the focused primary records its departure before handing focus to Main documents', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	await f.editor.navigation.openResource(f.parts.main.activeGroup, f.copy.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	f.main.focusPrimary(); resetNavigationHistoryState();
	assert.equal(await f.main.clearPrimary(f.parts.closeController), true);
	assert.equal(f.main.primary, undefined); assert.equal(f.main.serialize().activeClient, 'documents');
	assert.ok(navigationState.activeOwner === f.parts.main.activeGroup);
	assert.ok(inputFocus.admittedTarget !== null && f.parts.main.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(navigationState.back.length, 1); assert.equal(navigationState.back[0].target.kind, 'primary');
	await f.editor.navigation.goBackward();
	const restored = f.main.primary; assert.ok(restored instanceof ScenePrimaryClient);
	assert.ok(restored.consumer.subject === restored.consumer.document!.scenes[0]);
	assert.ok(navigationState.activeOwner === f.main);
});

test('a newer document focus from outgoing primary retirement is not stolen by the incoming attachment', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.main.primary; assert.ok(first instanceof ScenePrimaryClient);
	const dispose = first.dispose.bind(first);
	t.mock.method(first, 'dispose', () => { dispose(); f.second.focus(); });
	assert.equal(await f.open(1), true);
	const incoming = f.main.primary; assert.ok(incoming instanceof ScenePrimaryClient);
	assert.ok(incoming.consumer.subject === incoming.consumer.document!.scenes[1]);
	assert.ok(inputFocus.admittedTarget !== null && f.secondPart.scope.contains(inputFocus.admittedTarget.scope));
	assert.ok(f.parts.activePart === f.secondPart && navigationState.activeOwner === f.secondGroup);
});
