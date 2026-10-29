import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

type Fixture = ReturnType<typeof createActualSourcePanes>;

async function persistedFixture(t: TestContext, sameModel = false,
	additionalSources: readonly (readonly [string, string])[] = []) {
	const files = new MemoryWorkspaceFiles('workspace'); await openWorkspaceRecords(files);
	const f = createActualSourcePanes(t, sameModel, additionalSources);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	return { ...f, files };
}

/** Physical secondary events consume the current strip projection without selecting the clicked tab. */
function secondary(f: Fixture, group: EditorGroupView, input: EditorInput): void {
	f.update();
	const layout = group.tabStrip.layoutState, item = layout.items.peek(group.model.indexOf(input));
	const x = item.bounds.left + 2, y = (layout.viewportBounds.top + layout.viewportBounds.bottom) / 2;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Secondary : 0,
			pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
}

/** Semantic command ids select an actual menu action; wording and pixel geometry are not contracts. */
function acceptContext(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu, index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled, 'the actual tab menu admits the batch command');
	f.key('Home');
	for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown');
	assert.equal(menu.model.selectedIndex, index); f.key('Enter');
}

test('context Close Others keeps the exact inactive clicked tab without borrowing the focused sibling group', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	const other = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(other); f.second.focus();
	const focused = inputFocus.target;
	secondary(f, group, f.firstInput);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(group.model.activeTab === other);
	acceptContext(f, 'tabs.closeOthers');
	assert.deepEqual(group.model.tabs, [f.firstInput]);
	assert.ok(group.panes.activePane?.input === f.firstInput);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && inputFocus.target === focused);
	assert.equal(f.firstPart.retired, false); assert.equal(group.surface.retired, false);
});

test('Palette Close All retains its invoking group when a different document becomes active behind the picker', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	group.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); group.focus();
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'tabs.closeAll');
	assert.ok(index >= 0, 'Palette exposes the invoking group batch close');
	f.editor.editorParts.activate(f.secondPart);
	picker.model.list.selectionIndex = index; f.key('Enter');
	assert.equal(group.model.tabs.length, 0);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
	assert.equal(f.firstPart.retired, false); assert.equal(group.surface.retired, false);
});

test('physical Close All Editors chord closes every document but retains its real groups and windows', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main.activeGroup;
	main.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const side = parts.splitGroup(main, 'right'); side.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	const groups = [...parts.groups], windows = [...parts.documents], root = parts.main.arrangement.root;
	f.first.focus(); f.key('KeyK', KeyModifier.ctrl); f.key('KeyW', KeyModifier.ctrl);
	assert.ok(groups.every(group => group.model.tabs.length === 0), 'the physical chord reaches whole-workspace closure');
	assert.deepEqual(parts.groups, groups); assert.deepEqual(parts.documents, windows);
	assert.ok(parts.main.arrangement.root === root);
	assert.ok(groups.every(group => !group.surface.retired) && windows.every(part => !part.retired));
});

test('physical group Close All chord leaves sibling groups and their dirty shared source admitted', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, group = f.firstGroup;
	const sibling = parts.splitGroup(group, 'right'), retained = new CodeEditorInput(f.firstInput.workingCopy);
	sibling.openEditor(retained); f.first.focus();
	const root = f.firstPart.arrangement.root, model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained by the other real views\n' }]);
	const source = model.buffer.getText();
	f.key('KeyK', KeyModifier.ctrl); f.key('KeyW');
	assert.equal(group.model.tabs.length, 0);
	assert.ok(sibling.model.activeTab === retained && f.secondGroup.model.activeTab === f.secondInput);
	assert.ok(f.firstPart.arrangement.root === root && !group.surface.retired && !f.firstPart.retired);
	assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true); assert.equal(model.canUndo, true);
	assert.equal(f.firstPart.actionPrompt.visible, false); assert.equal(f.editor.actionPrompt.visible, false);
});

test('group batch decision is local and does not publish or blur an excluded sibling draft', async t => {
	const f = await persistedFixture(t), group = f.firstGroup, target = f.second.code.focusTarget;
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- group decision\n' }]);
	target.focus(); const previous = target.edit;
	let attempts = 0;
	const draft = { pending: true, commit() { attempts++; return false; }, cancel() { this.pending = false; } };
	target.edit = draft; t.after(() => { target.edit = previous; });
	const closing = f.editor.editorParts.closeEditors({ kind: 'group', group }, f.first.commandTarget);
	assert.equal(f.firstPart.actionPrompt.visible, true); assert.equal(f.editor.actionPrompt.visible, false);
	assert.equal(f.editor.surfaces.isAdmitted(f.secondGroup.paneSurface), true);
	assert.ok(inputFocus.target === target && target.edit === draft); assert.equal(attempts, 0); assert.equal(draft.pending, true);
	f.firstPart.actionPrompt.close('cancel'); assert.equal(await closing, false);
	assert.ok(group.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	assert.ok(inputFocus.target === target && target.edit === draft); assert.equal(attempts, 0);
});

test('workspace batch decision blocks every document and Cancel retains the entire captured target set', async t => {
	const f = await persistedFixture(t), parts = f.editor.editorParts;
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- workspace decision\n' }]); f.first.focus();
	const targets = parts.groups.flatMap(group => group.model.tabs.map(input => ({ group, input })));
	const closing = parts.closeEditors({ kind: 'workspace' }, f.first.commandTarget);
	assert.equal(f.editor.actionPrompt.visible, true);
	assert.equal(f.firstPart.actionPrompt.visible, false); assert.equal(f.secondPart.actionPrompt.visible, false);
	assert.equal(f.editor.surfaces.isAdmitted(f.firstGroup.paneSurface), false);
	assert.equal(f.editor.surfaces.isAdmitted(f.secondGroup.paneSurface), false);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(targets.every(({ group, input }) => group.model.contains(input)));
	assert.equal(f.firstInput.workingCopy.dirty, true);
	assert.equal(f.editor.surfaces.isAdmitted(f.firstGroup.paneSurface), true);
	assert.equal(f.editor.surfaces.isAdmitted(f.secondGroup.paneSurface), true);
});

test('Cancel after an accepted batch Save retains all views without rolling back the saved baseline', async t => {
	const f = await persistedFixture(t), parts = f.editor.editorParts, first = f.firstInput.workingCopy, second = f.secondInput.workingCopy;
	first.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted first Save\n' }]);
	second.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- cancel the remaining decision\n' }]);
	const saved = first.buffer.getText(), retained = second.buffer.getText(); f.first.focus();
	const closing = parts.closeEditors({ kind: 'workspace' }, f.first.commandTarget);
	assert.equal(f.editor.actionPrompt.visible, true); f.key('Enter'); await setImmediate();
	assert.equal(f.files.records.get('first.lua')!.contents, saved);
	assert.equal(first.dirty, false); assert.equal(second.dirty, true); assert.equal(f.editor.actionPrompt.visible, true);
	assert.ok(f.firstGroup.model.contains(f.firstInput) && f.secondGroup.model.contains(f.secondInput));
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(f.firstGroup.model.contains(f.firstInput) && f.secondGroup.model.contains(f.secondInput));
	assert.equal(first.buffer.getText(), saved); assert.equal(first.dirty, false); assert.equal(first.canUndo, true);
	assert.equal(second.buffer.getText(), retained); assert.equal(second.dirty, true); assert.equal(second.canUndo, true);
});

test('a group batch awaiting Save retires only its snapshot and admits a newly opened surviving tab', async t => {
	const writing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
	// Accepted filesystem work drains before the real workbench fixture shuts down, even after a failed assertion.
	t.after(() => release.resolve());
	const f = await persistedFixture(t), group = f.firstGroup;
	const write = f.files.write.bind(f.files);
	t.mock.method(f.files, 'write', async (...args: Parameters<typeof write>) => {
		writing.resolve(); await release.promise; await write(...args);
	});
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- snapshot Save\n' }]); f.first.focus();
	const source = f.firstInput.workingCopy.buffer.getText();
	const closing = f.editor.editorParts.closeEditors({ kind: 'group', group }, f.first.commandTarget);
	f.key('Enter'); await writing.promise;
	const newer = new HomeInput(null); group.openEditor(newer);
	assert.ok(group.model.contains(f.firstInput) && group.model.activeTab === newer);
	assert.equal(group.openingAdmitted, true);
	release.resolve(); assert.equal(await closing, true);
	assert.deepEqual(group.model.tabs, [newer]); assert.ok(group.panes.activePane?.input === newer);
	assert.equal(f.files.records.get('first.lua')!.contents, source); assert.equal(f.firstInput.workingCopy.dirty, false);
	assert.equal(group.surface.retired, false); assert.equal(f.firstPart.retired, false);
});

test('workspace batch makes one final decision per canonical copy represented by duplicate Sources and an imported-effect lens', async t => {
	const f = await persistedFixture(t, false, [['cartlib/actioneffects.lua', 'return {}']]);
	const main = f.firstInput.workingCopy, imported = f.secondInput.workingCopy;
	const registration = "local effects<const> = require('cartlib/actioneffects')\neffects.register_effect('batch.fixture', require('second'))";
	const definition = "return { period_ms = 40, blocked_tags = { 'busy' }, handler = function(owner) owner:act() end }";
	main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length, text: registration }]);
	imported.pushEditOperations([{ offset: 0, deleteLength: imported.buffer.length, text: definition }]);
	const lens = f.editor.behaviorLens.createInput(main, 'properties');
	selectBehaviorLensDefinition(lens.view, lens.view.document.definitions[0].rowKey); lens.updateDefinition();
	assert.equal(lens.getWorkingCopies().length, 2); assert.ok(lens.getWorkingCopies().includes(imported));
	f.firstGroup.openEditor(lens); const duplicate = new CodeEditorInput(main); f.secondGroup.openEditor(duplicate);
	const decisions = t.mock.method(f.editor.actionPrompt, 'show'); f.firstGroup.focus();
	const closing = f.editor.editorParts.closeEditors({ kind: 'workspace' }, f.firstGroup.panes.activePane!.commandTarget);
	assert.equal(decisions.mock.callCount(), 1); f.editor.actionPrompt.close('secondary'); await setImmediate();
	assert.equal(decisions.mock.callCount(), 2);
	assert.equal(main.buffer.getText(), registration); assert.equal(imported.buffer.getText(), definition);
	assert.equal(main.dirty, true); assert.equal(imported.dirty, true);
	assert.ok(f.firstGroup.model.contains(lens) && f.firstGroup.model.contains(f.firstInput)
		&& f.secondGroup.model.contains(duplicate) && f.secondGroup.model.contains(f.secondInput));
	f.editor.actionPrompt.close('secondary'); assert.equal(await closing, true);
	assert.equal(decisions.mock.callCount(), 2);
	assert.equal(main.buffer.getText(), f.source); assert.equal(imported.buffer.getText(), f.otherSource);
	assert.equal(main.dirty, false); assert.equal(imported.dirty, false); assert.equal(f.files.records.size, 0);
	assert.equal(f.firstGroup.model.tabs.length, 0); assert.equal(f.secondGroup.model.tabs.length, 0);
});

test('workspace Close All retains Main primary, activity, file selection and layout while their dirty copy stays authored', async t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const parts = f.editor.editorParts, main = f.editor.mainWorkspace, resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus(); assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const central = parts.main.activeGroup; central.openEditor(new CodeEditorInput(model));
	const split = parts.splitGroup(central, 'right'); split.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	parts.main.arrangement.splits[0].split.ratio = 0.6;
	parts.minimize(f.firstPart); f.secondPart.window!.setPlacement('maximized');
	f.editor.resourcePanel.show(); f.editor.resourcePanel.queuePendingSelection(resource); f.editor.resourcePanel.applyPendingSelection();
	main.openActivity('problems'); main.setActivityVisible(true); f.update(); main.focusActivity();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained Main authored consumer\n' }]);
	const source = model.buffer.getText(), selected = primary.consumer.selection, subject = primary.consumer.subject;
	const groups = [...parts.groups], windows = [...parts.documents], root = parts.main.arrangement.root;
	const activity = main.activity, activityScope = activity!.scope.contextGeneration, focus = inputFocus.target;
	const file = f.editor.resourcePanel.files.selectedNode, catalog = f.sources.catalog, contexts = [...catalog.contexts];
	assert.equal(await parts.closeEditors({ kind: 'workspace' }, focus), true);
	assert.ok(groups.every(group => group.model.tabs.length === 0 && !group.surface.retired));
	assert.deepEqual(parts.groups, groups); assert.deepEqual(parts.documents, windows);
	assert.ok(parts.main.arrangement.root === root); assert.equal(parts.main.arrangement.splits[0].split.ratio, 0.6);
	assert.equal(f.firstPart.window!.model.minimized, true); assert.equal(f.secondPart.window!.model.placement, 'maximized');
	assert.ok(main.primary === primary && primary.consumer.selection === selected && primary.consumer.subject === subject);
	assert.ok(main.activity === activity && activity!.attached && inputFocus.target === focus);
	assert.equal(activity!.scope.contextGeneration, activityScope); assert.equal(main.regionLayout.activityVisible, true);
	assert.ok(f.editor.resourcePanel.files.selectedNode === file && f.sources.catalog === catalog);
	assert.deepEqual([...catalog.contexts], contexts); assert.ok(catalog.resolveResource(resource) === resource);
	assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true); assert.equal(model.canUndo, true);
	assert.equal(f.editor.actionPrompt.visible, false);
});

test('batch close never constructs or activates an inactive doomed pane', async t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	const inactive = new ResourceViewerInput(f.sources.catalog, f.firstInput.workingCopy.resource); group.model.add(inactive);
	const activation = t.mock.method(group.panes, 'openEditor');
	assert.equal(group.panes.getPane('resource_view'), undefined);
	assert.equal(await f.editor.editorParts.closeEditors({ kind: 'group', group }, f.first.commandTarget), true);
	assert.equal(activation.mock.callCount(), 0, 'retirement never visits another captured closing input');
	assert.equal(group.panes.getPane('resource_view'), undefined); assert.equal(group.panes.activePane, null);
	assert.equal(group.model.tabs.length, 0); assert.equal(group.surface.retired, false); assert.equal(f.firstPart.retired, false);
});

test('Close Others pins its exact preview keeper after snapshotting targets so a pin callback can open a surviving tab', async t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	const keeper = new CodeEditorInput(f.secondInput.workingCopy), newer = new HomeInput(null);
	group.openEditor(keeper, { pinned: false }); group.activate(f.firstInput.id); f.first.focus();
	assert.ok(group.model.previewTab === keeper);
	const unbind = group.model.onDidChange(change => {
		if (change !== 'pin') return;
		unbind(); group.openEditor(newer);
	}); t.after(unbind);
	assert.equal(await f.editor.editorParts.closeEditors({ kind: 'others', group, input: keeper }, f.first.commandTarget), true);
	assert.equal(group.model.previewTab, null); assert.ok(group.model.contains(keeper) && group.model.contains(newer));
	assert.equal(group.model.contains(f.firstInput), false);
	assert.ok(group.model.activeTab === newer && group.panes.activePane?.input === newer);
});

test('overlapping batch synchronously reserves uncovered targets and prerequisite Cancel retains their membership', async t => {
	const f = createActualSourcePanes(t, false, [['third.lua', 'return 3\n']]), parts = f.editor.editorParts, group = parts.main.activeGroup;
	const pending = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	const uncovered = new CodeEditorInput(f.firstInput.workingCopy); group.openEditor(pending); group.openEditor(uncovered);
	pending.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- original close decision\n' }]); group.focus();
	const decisions = t.mock.method(parts.main.actionPrompt, 'show'), original = group.close(pending.id);
	assert.equal(parts.main.actionPrompt.visible, true); assert.equal(decisions.mock.callCount(), 1);
	const batch = parts.closeEditors({ kind: 'group', group }, group.focusTarget);
	assert.equal(parts.closeController.isPending(pending), true); assert.equal(parts.closeController.isPending(uncovered), true);
	assert.equal(parts.closeController.transfer([uncovered], () => assert.fail('an uncovered batch target cannot transfer while awaiting its prerequisite')), false);
	assert.equal(parts.moveEditor(group, uncovered, { kind: 'group', group: f.secondGroup }), false);
	assert.equal(decisions.mock.callCount(), 1, 'the batch waits the existing decision without replacing its owner');
	parts.main.actionPrompt.close('cancel');
	assert.equal(await original, false); assert.equal(await batch, false);
	assert.ok(group.model.contains(pending) && group.model.contains(uncovered));
	assert.equal(parts.closeController.isPending(pending), false); assert.equal(parts.closeController.isPending(uncovered), false);
	assert.equal(pending.workingCopy.dirty, true); assert.equal(group.surface.retired, false);
});

test('a newer Close Others admitted during keeper pin retains its exact keeper while both batches await an existing close', async t => {
	const f = createActualSourcePanes(t, false, [['third.lua', 'return 3\n']]), parts = f.editor.editorParts, group = parts.main.activeGroup;
	const oldKeeper = new CodeEditorInput(f.firstInput.workingCopy), newKeeper = new CodeEditorInput(f.secondInput.workingCopy);
	const pending = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	group.openEditor(oldKeeper, { pinned: false }); group.openEditor(newKeeper); group.openEditor(pending);
	assert.ok(group.model.previewTab === oldKeeper);
	pending.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- independent pending close\n' }]); group.focus();
	const original = group.close(pending.id); assert.equal(parts.main.actionPrompt.visible, true);
	let newer: Promise<boolean> | undefined;
	const unbind = group.model.onDidChange(change => {
		if (change !== 'pin') return;
		unbind(); newer = parts.closeEditors({ kind: 'others', group, input: newKeeper }, group.focusTarget);
	}); t.after(unbind);
	const older = parts.closeEditors({ kind: 'others', group, input: oldKeeper }, group.focusTarget);
	assert.ok(newer !== undefined); assert.equal(await older, false);
	assert.equal(parts.closeController.isPending(oldKeeper), true);
	assert.equal(parts.closeController.isPending(newKeeper), false);
	parts.main.actionPrompt.close('secondary');
	assert.equal(await original, true); assert.equal(await newer, true);
	assert.deepEqual(group.model.tabs, [newKeeper]); assert.ok(group.panes.activePane?.input === newKeeper);
	assert.equal(group.surface.retired, false); assert.equal(parts.main.retired, false);
});

test('an overlapping predecessor never activates the lazy successor already reserved by its waiting batch', async t => {
	const f = createActualSourcePanes(t, false, [['third.lua', 'return 3\n']]), parts = f.editor.editorParts, group = parts.main.activeGroup;
	const pending = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	group.openEditor(pending);
	const lazy = new ResourceViewerInput(f.sources.catalog, f.firstInput.workingCopy.resource); group.model.add(lazy);
	pending.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- predecessor decision\n' }]); group.focus();
	const original = group.close(pending.id);
	assert.equal(parts.main.actionPrompt.visible, true); assert.equal(group.panes.getPane('resource_view'), undefined);
	const activation = t.mock.method(group.panes, 'openEditor'), batch = parts.closeEditors({ kind: 'group', group }, group.focusTarget);
	assert.equal(parts.closeController.isPending(lazy), true);
	parts.main.actionPrompt.close('secondary');
	assert.equal(await original, true); assert.equal(await batch, true);
	assert.equal(activation.mock.callCount(), 0, 'predecessor retirement consumes the shared admission set, not only its own targets');
	assert.equal(group.panes.getPane('resource_view'), undefined); assert.equal(group.panes.activePane, null);
	assert.equal(group.model.tabs.length, 0); assert.equal(group.surface.retired, false);
});

test('a captured Close Others target moved away and back during keeper pin belongs to its newer membership', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = parts.main.activeGroup;
	const keeper = new CodeEditorInput(f.firstInput.workingCopy), target = new CodeEditorInput(f.secondInput.workingCopy);
	group.openEditor(keeper, { pinned: false }); group.openEditor(target); group.focus();
	const receiver = parts.createDocument().activeGroup;
	const unbind = group.model.onDidChange(change => {
		if (change !== 'pin') return;
		unbind();
		assert.equal(parts.moveEditor(group, target, { kind: 'group', group: receiver }), true);
		assert.ok(receiver.model.activeTab === target && !group.model.contains(target));
		assert.equal(parts.moveEditor(receiver, target, { kind: 'group', group }), true);
	}); t.after(unbind);
	assert.equal(await parts.closeEditors({ kind: 'others', group, input: keeper }, group.focusTarget), false);
	assert.ok(group.model.contains(keeper) && group.model.contains(target));
	assert.ok(group.model.activeTab === target && group.panes.activePane?.input === target);
	assert.equal(parts.closeController.isPending(target), false); assert.equal(group.surface.retired, false);
});

/** Both dirty copies have only their own group input as consumer; the inactive Scene has no constructed pane. */
function deferredSelectionFixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['closing.lua', 'return 3\n'], ['deferred.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const parts = f.editor.editorParts, group = parts.main.activeGroup;
	const first = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'closing.lua' })!);
	const deferredModel = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'deferred.lua' })!);
	const deferred = new SceneEditorInput(deferredModel, f.editor.sceneEditor.documents, f.editor.sceneEditor.createView);
	group.openEditor(first); group.model.add(deferred);
	first.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first pending close\n' }]);
	deferredModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- deferred pending close\n' }]); group.focus();
	assert.equal(group.panes.getPane('scene_editor'), undefined);
	const original = group.close(first.id, group.focusTarget);
	assert.equal(parts.main.actionPrompt.visible, true);
	const activation = t.mock.method(group.panes, 'openEditor'), batch = parts.closeEditors({ kind: 'group', group }, group.focusTarget);
	return { ...f, parts, group, first, deferred, original, activation, batch };
}

test('Cancel of a deferred successor close restores its exact lazy pane without stealing unrelated group focus', async t => {
	const f = deferredSelectionFixture(t);
	f.parts.main.actionPrompt.close('secondary'); assert.equal(await f.original, true); await setImmediate();
	assert.equal(f.parts.main.actionPrompt.visible, true);
	assert.ok(f.group.model.contains(f.deferred)); assert.equal(f.group.model.contains(f.first), false);
	assert.equal(f.activation.mock.callCount(), 0); assert.equal(f.group.panes.getPane('scene_editor'), undefined);
	f.second.focus(); const focused = inputFocus.target;
	f.parts.main.actionPrompt.close('cancel'); assert.equal(await f.batch, false);
	assert.ok(f.group.model.activeTab === f.deferred && f.group.panes.activePane?.input === f.deferred);
	assert.equal(f.activation.mock.callCount(), 1); assert.ok(f.group.panes.getPane('scene_editor') !== undefined);
	assert.ok(inputFocus.target === focused && f.parts.activeGroup === f.secondGroup);
	assert.equal(f.deferred.workingCopy.dirty, true); assert.equal(f.parts.closeController.isPending(f.deferred), false);
});

test('a newer admitted opening supersedes deferred close selection when the reserved successor later cancels', async t => {
	const f = deferredSelectionFixture(t);
	f.parts.main.actionPrompt.close('secondary'); assert.equal(await f.original, true); await setImmediate();
	assert.equal(f.parts.main.actionPrompt.visible, true);
	assert.equal(f.activation.mock.callCount(), 0); assert.equal(f.group.panes.getPane('scene_editor'), undefined);
	const newer = new HomeInput(null); f.group.openEditor(newer, { preserveFocus: true });
	const pane = f.group.panes.activePane; assert.ok(pane?.input === newer);
	f.parts.main.actionPrompt.close('cancel'); assert.equal(await f.batch, false);
	assert.ok(f.group.model.contains(f.deferred) && f.group.model.activeTab === newer && f.group.panes.activePane === pane);
	assert.equal(f.activation.mock.callCount(), 1); assert.equal(f.group.panes.getPane('scene_editor'), undefined);
	assert.equal(f.deferred.workingCopy.dirty, true); assert.equal(f.parts.closeController.isPending(f.deferred), false);
});

test('accepted deferred successor close retires its dirty input without ever constructing the doomed pane', async t => {
	const f = deferredSelectionFixture(t);
	f.parts.main.actionPrompt.close('secondary'); assert.equal(await f.original, true); await setImmediate();
	assert.equal(f.parts.main.actionPrompt.visible, true); assert.equal(f.activation.mock.callCount(), 0);
	f.parts.main.actionPrompt.close('secondary'); assert.equal(await f.batch, true);
	assert.equal(f.activation.mock.callCount(), 0); assert.equal(f.group.panes.getPane('scene_editor'), undefined);
	assert.equal(f.group.model.tabs.length, 0); assert.equal(f.group.panes.activePane, null);
	assert.equal(f.deferred.workingCopy.dirty, false); assert.equal(f.group.surface.retired, false);
});

test('deferred close selection reaches its later retained candidate after the preferred waiting successor closes', async t => {
	const f = createActualSourcePanes(t, false, [['close-a.lua', 'return 3\n'], ['close-b.lua', 'return 4\n'], ['close-c.lua', 'return 5\n']]);
	const parts = f.editor.editorParts, group = parts.main.activeGroup;
	const inputs = ['close-a.lua', 'close-b.lua', 'close-c.lua'].map(path => resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!));
	const [first, preferred, retained] = inputs;
	group.openEditor(first); group.model.add(preferred); group.model.add(retained);
	for (const input of inputs) input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- independent close decision\n' }]);
	group.focus();
	const activation = t.mock.method(group.panes, 'openEditor'), original = group.close(first.id, group.focusTarget);
	const earlier = parts.closeEditors({ kind: 'others', group, input: retained }, group.focusTarget);
	const later = parts.closeEditors({ kind: 'group', group }, group.focusTarget);
	assert.ok(inputs.every(input => parts.closeController.isPending(input)));
	parts.main.actionPrompt.close('secondary'); assert.equal(await original, true); await setImmediate();
	assert.equal(parts.main.actionPrompt.visible, true); assert.equal(activation.mock.callCount(), 0);
	assert.equal(group.model.activeTab, null); assert.ok(group.model.contains(preferred) && group.model.contains(retained));
	parts.main.actionPrompt.close('secondary'); assert.equal(await earlier, true); await setImmediate();
	assert.equal(parts.main.actionPrompt.visible, true); assert.equal(activation.mock.callCount(), 0);
	assert.deepEqual(group.model.tabs, [retained]); assert.equal(group.model.activeTab, null);
	f.second.focus(); const focused = inputFocus.target;
	parts.main.actionPrompt.close('cancel'); assert.equal(await later, false);
	assert.ok(group.model.activeTab === retained && group.panes.activePane?.input === retained);
	assert.equal(activation.mock.callCount(), 1); assert.ok(inputFocus.target === focused && parts.activeGroup === f.secondGroup);
	assert.equal(first.workingCopy.dirty, false); assert.equal(preferred.workingCopy.dirty, false); assert.equal(retained.workingCopy.dirty, true);
	assert.equal(parts.closeController.isPending(retained), false); assert.equal(group.surface.retired, false);
});

for (const scope of ['group', 'document part'] as const)
	test(`Cancel of an overlapping ${scope} close restores the deferred exact pane when its parent reopens admission`, async t => {
		const f = createActualSourcePanes(t, false, [['closing.lua', 'return 3\n'], ['deferred.lua', SCENE_VIEWPORT_SOURCE],
			['cartlib/world/scene_library.lua', 'return {}']]);
		const parts = f.editor.editorParts, part = scope === 'group' ? parts.main : parts.createDocument();
		const group = scope === 'group' ? part.splitGroup(part.activeGroup, 'right') : part.activeGroup;
		const first = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'closing.lua' })!);
		const deferredModel = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
			f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'deferred.lua' })!);
		const deferred = new SceneEditorInput(deferredModel, f.editor.sceneEditor.documents, f.editor.sceneEditor.createView);
		group.openEditor(first); group.model.add(deferred);
		first.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first pending close\n' }]);
		deferredModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- parent close may cancel\n' }]); group.focus();
		const original = group.close(first.id, group.focusTarget);
		const closing = scope === 'group' ? parts.closeGroup(group, group.focusTarget) : parts.close(part);
		part.actionPrompt.close('secondary'); assert.equal(await original, true); await setImmediate();
		assert.equal(part.actionPrompt.visible, true);
		f.second.focus(); const focused = inputFocus.target;
		part.actionPrompt.close('cancel'); assert.equal(await closing, false);
		assert.ok(group.model.activeTab === deferred && group.panes.activePane?.input === deferred);
		assert.equal(group.openingAdmitted, true); assert.equal(part.operation, 'none');
		assert.ok(inputFocus.target === focused && parts.activeGroup === f.secondGroup);
		assert.equal(deferredModel.dirty, true); assert.equal(parts.closeController.isPending(deferred), false);
		assert.equal(group.surface.retired, false); assert.equal(part.retired, false);
	});

test('Close Group is disabled on the final empty Main group because there is no content or topology to retire', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = parts.main.activeGroup;
	const groups = [...parts.groups]; assert.equal(group.model.tabs.length, 0);
	assert.equal(parts.canCloseGroup(group), false);
	assert.equal(f.editor.commands.isEnabled('group.close', group.focusTarget), false);
	assert.equal(await parts.closeGroup(group, group.focusTarget), false);
	assert.deepEqual(parts.groups, groups); assert.equal(group.surface.retired, false); assert.equal(parts.main.retired, false);
});
