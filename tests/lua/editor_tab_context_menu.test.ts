import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import type { EditorCommandId } from '../../ide/common/commands';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

type Fixture = ReturnType<typeof createActualSourcePanes>;

/** Physical events use the retained strip projection; no document is activated to invoke its menu. */
function secondary(f: Fixture, group: EditorGroupView, input?: EditorInput): void {
	f.update();
	const layout = group.tabStrip.layoutState;
	const item = input === undefined ? undefined : layout.items.peek(group.model.indexOf(input));
	const x = item === undefined ? layout.viewportBounds.right - 2 : item.bounds.left + 2;
	const y = (layout.viewportBounds.top + layout.viewportBounds.bottom) / 2;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Secondary : 0,
			pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
}

function accept(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu;
	const index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled, 'the invoked editor exposes this admitted action');
	f.key('Home');
	for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown');
	assert.equal(menu.model.selectedIndex, index);
	f.key('Enter');
}

test('secondary press on an inactive tab retains the clicked editor without activating it or borrowing another group', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	const active = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(active);
	f.second.focus(); const focused = inputFocus.target, activeGroup = f.editor.editorParts.activeGroup, pane = group.panes.activePane;
	secondary(f, group, f.firstInput);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(group.model.activeTab === active && group.panes.activePane === pane);
	assert.ok(f.editor.editorParts.activeGroup === activeGroup);
	assert.ok(inputFocus.target === f.editor.contextMenu.focusTarget && f.editor.contextMenu.returnFocus === focused);
	accept(f, 'tabs.close');
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(group.model.contains(f.firstInput), false);
	assert.ok(group.model.activeTab === active && group.panes.activePane === pane);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('Keep Open pins the clicked inactive preview without selecting it or replacing the active control', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup, preview = new CodeEditorInput(f.secondInput.workingCopy);
	group.openEditor(preview, { pinned: false }); group.activate(f.firstInput.id); f.first.focus();
	const pane = group.panes.activePane;
	assert.ok(group.model.previewTab === preview);
	secondary(f, group, preview); accept(f, 'keepEditor');
	assert.equal(group.model.previewTab, null);
	assert.ok(group.model.activeTab === f.firstInput && group.panes.activePane === pane);
	assert.ok(group.model.tabs[0] === f.firstInput && group.model.tabs[1] === preview);
});

test('Save from an inactive Source tab publishes only its canonical working copy and preserves both Undo histories', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = createActualSourcePanes(t), group = f.firstGroup, input = f.firstInput;
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const active = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(active);
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- clicked source\n' }]);
	active.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- other source\n' }]);
	const source = input.workingCopy.buffer.getText(), other = active.workingCopy.buffer.getText(), pane = group.panes.activePane;
	let unrelatedCommits = 0;
	const focused = pane!.commandTarget;
	focused.edit = { pending: true, commit: () => { unrelatedCommits++; return false; } };
	t.after(() => { focused.edit = undefined; });
	secondary(f, group, input); accept(f, 'save');
	const operation = f.ide.textFileSaves.latestOperation(input.workingCopy);
	assert.ok(operation !== undefined); assert.equal((await operation.completion).status, 'saved');
	assert.ok([...files.records.values()].some(record => record.contents === source), 'Save preserves exact authored source');
	assert.equal(input.workingCopy.dirty, false); assert.equal(active.workingCopy.dirty, true);
	assert.equal(input.workingCopy.canUndo, true); assert.equal(active.workingCopy.canUndo, true);
	assert.equal(unrelatedCommits, 0);
	assert.equal(active.workingCopy.buffer.getText(), other);
	assert.ok(group.model.activeTab === active && group.panes.activePane === pane);
});

test('Move Editor retains the inactive clicked Source throughout the chooser and leaves its active sibling control intact', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = f.firstGroup, input = f.firstInput;
	const active = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(active); group.focus();
	const pane = group.panes.activePane, model = input.workingCopy, source = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained move\n' }]);
	secondary(f, group, input); accept(f, 'window.moveEditor');
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true); assert.ok(group.model.activeTab === active && group.panes.activePane === pane);
	type Item = QuickPickItem & { readonly destination: EditorMoveDestination };
	const index = picker.model.list.rows.findIndex(row => {
		const destination = (row.item as Item).destination;
		return destination.kind === 'group' && destination.group === f.secondGroup;
	});
	assert.ok(index >= 0); f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	f.key('Enter');
	assert.equal(picker.visible, false); assert.ok(parts.findGroup(input) === f.secondGroup);
	assert.ok(f.secondGroup.model.activeTab === input && f.secondGroup.panes.activePane?.input === input);
	assert.ok(group.model.activeTab === active && group.panes.activePane === pane);
	assert.equal(model.buffer.getText(), `-- retained move\n${source}`); assert.equal(model.canUndo, true); assert.equal(model.dirty, true);
});

test('Open in New Window creates a view of the inactive clicked Source rather than the active sibling model', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = f.firstGroup, input = f.firstInput;
	const active = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(active);
	const pane = group.panes.activePane, previous = [...parts.documents], model = input.workingCopy;
	const source = model.buffer.getText(); model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared Undo\n' }]);
	secondary(f, group, input); accept(f, 'window.copyEditor');
	const host = parts.documents.find(part => !previous.includes(part)); assert.ok(host !== undefined);
	const view = host.activeGroup.model.activeTab;
	assert.ok(view instanceof CodeEditorInput && view !== input && view.workingCopy === model);
	assert.ok(parts.findGroup(input) === group && group.model.activeTab === active && group.panes.activePane === pane);
	const newPane = host.activeGroup.panes.activePane; assert.ok(newPane !== null && newPane.input === view);
	f.editor.commands.execute('undo', newPane.commandTarget); f.update();
	assert.equal(model.buffer.getText(), source); assert.equal(model.canRedo, true);
	assert.equal(active.workingCopy.buffer.getText(), f.otherSource);
});

for (const replace of [false, true]) test(`removing the menu's exact editor ${replace ? 'and admitting the same id again ' : ''}revokes its command subject`, t => {
	const f = createActualSourcePanes(t), group = f.firstGroup, original = f.firstInput;
	const active = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(active);
	secondary(f, group, original); assert.equal(f.editor.contextMenu.visible, true);
	group.removeEditor(original);
	const replacement = replace ? new CodeEditorInput(original.workingCopy) : undefined;
	if (replacement !== undefined) group.openEditor(replacement);
	assert.equal(f.editor.contextMenu.visible, false);
	f.editor.commands.execute('tabs.close', group.tabFocusTarget, original);
	assert.equal(group.model.contains(active), true);
	assert.ok(group.model.activeTab === (replacement ?? active));
	if (replacement !== undefined) assert.equal(group.model.contains(replacement), true);
});

for (const replace of [false, true]) test(`a departing control can ${replace ? 'replace' : 'remove'} the clicked editor before popup focus without leaving a stale menu`, t => {
	const f = createActualSourcePanes(t), group = f.firstGroup, original = f.firstInput;
	const active = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(active); f.second.focus();
	const origin = inputFocus.target!, replacement = replace ? new CodeEditorInput(original.workingCopy) : undefined;
	let changed = false;
	const unbind = origin.onDidBlur(() => {
		unbind(); changed = true; group.removeEditor(original);
		if (replacement !== undefined) group.openEditor(replacement);
	}); t.after(unbind);
	secondary(f, group, original);
	assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(group.model.contains(original), false); assert.equal(group.model.contains(active), true);
	assert.ok(group.model.activeTab === (replacement ?? active));
	if (replacement !== undefined) assert.equal(group.model.contains(replacement), true);
});

test('retiring the invoking editor group closes its tab menu without transferring authority to another group', async t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	secondary(f, group, f.firstInput); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(await f.editor.editorParts.close(f.firstPart), true);
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(group.surface.retired, true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('accepting an inactive tab action retains its editor when focus return admits a newer editor elsewhere', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup, active = new CodeEditorInput(f.secondInput.workingCopy);
	group.openEditor(active); f.second.focus();
	secondary(f, group, f.firstInput); assert.equal(f.editor.contextMenu.visible, true);
	const newer = new HomeInput(null), origin = f.editor.contextMenu.returnFocus!;
	let redirected = false;
	const unbind = origin.onDidFocus(() => { unbind(); redirected = true; f.secondGroup.openEditor(newer); }); t.after(unbind);
	accept(f, 'tabs.close');
	assert.equal(redirected, true); assert.equal(group.model.contains(f.firstInput), false);
	assert.ok(group.model.activeTab === active && f.secondGroup.model.activeTab === newer && f.secondGroup.panes.activePane?.input === newer);
});

test('secondary strip background invokes only its own group without inventing an editor subject', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	f.second.focus(); const active = f.editor.editorParts.activeGroup, pane = group.panes.activePane;
	secondary(f, group); assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(f.editor.editorParts.activeGroup === active && group.panes.activePane === pane && group.model.activeTab === f.firstInput);
	accept(f, 'group.splitRight');
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.firstPart.groups.includes(group) && group.model.activeTab === f.firstInput);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const)
	test(`${code} on actual tab-strip chrome opens its group menu and cancels back to that same control`, t => {
		const f = createActualSourcePanes(t), group = f.firstGroup, chrome = group.tabStrip.actionBar.focusTarget;
		chrome.focus(); const pane = group.panes.activePane;
		f.key(code, modifiers); assert.equal(f.editor.contextMenu.visible, true);
		assert.ok(group.model.activeTab === f.firstInput && group.panes.activePane === pane);
		assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'group.move'));
		f.key('Escape'); assert.equal(f.editor.contextMenu.visible, false);
		assert.ok(inputFocus.target === chrome);
	});
