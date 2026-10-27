import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import type { EditorCommandId } from '../../ide/common/commands';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function threeSources(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['third.lua', 'local gamma = 3\nreturn gamma\n']]);
	const group = f.firstGroup, secondSource = new CodeEditorInput(f.secondInput.workingCopy);
	const third = resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	group.openEditor(secondSource); group.openEditor(third, { pinned: false }); group.activate(f.firstInput.id); f.first.focus(); f.update();
	return { ...f, group, secondSource, third };
}

/** Select semantic commands through the real Palette, independent of incidental wording or order. */
function palette(f: ReturnType<typeof threeSources>, command: EditorCommandId): void {
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = f.editor.quickInput; assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === command);
	assert.ok(index >= 0); f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	f.key('Enter');
}

test('Focus Tabs is discoverable through the real Palette and horizontal roving never rebinds the active Source pane', t => {
	const f = threeSources(t), strip = f.group.tabStrip, pane = f.group.panes.activePane;
	const generation = f.group.panes.openGeneration;
	palette(f, 'group.focusTabs');
	assert.ok(inputFocus.target === strip.focusTarget && strip.focusedInput === f.firstInput);
	for (const [key, input] of [['ArrowRight', f.secondSource], ['ArrowRight', f.third], ['ArrowRight', f.firstInput],
		['ArrowLeft', f.third], ['Home', f.firstInput], ['End', f.third]] as const) {
		f.key(key);
		assert.ok(strip.focusedInput === input && inputFocus.target === strip.focusTarget);
		assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane && pane!.input === f.firstInput);
		assert.equal(f.group.panes.openGeneration, generation);
	}
});

for (const code of ['Enter', 'NumpadEnter', 'Space']) test(`${code} activates exactly the roving Source on matching release while Escape enters its actual pane`, t => {
	const f = threeSources(t), strip = f.group.tabStrip;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	const generation = strip.focusTarget.scope.contextGeneration;
	f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none));
	f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, true, true));
	assert.ok(f.group.model.activeTab === f.firstInput && strip.focusedInput === f.secondSource);
	f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false)); f.update();
	assert.ok(f.group.model.activeTab === f.secondSource && f.group.panes.activePane?.input === f.secondSource);
	assert.ok(inputFocus.target === strip.focusTarget && strip.focusedInput === f.secondSource);
	assert.equal(strip.focusTarget.scope.contextGeneration, generation, 'pane retirement cannot retire its sibling tab control');
	f.key('Escape'); assert.ok(inputFocus.target === f.group.panes.activePane!.commandTarget);
});

test('Tab and Shift+Tab move between the actual strip and its existing action toolbar without activating a roving editor', t => {
	const f = threeSources(t), strip = f.group.tabStrip, pane = f.group.panes.activePane;
	f.firstBounds.right = 180; f.update();
	assert.ok(strip.actions.items.some(item => item.visible && item.enabled && !item.overflowed));
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	f.key('Tab'); assert.ok(inputFocus.target === strip.actionBar.focusTarget);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.target === strip.focusTarget);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane);
});

for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const)
	test(`${code} on an inactive roving tab closes exactly that retained editor and returns to the strip`, t => {
		const f = threeSources(t), strip = f.group.tabStrip, pane = f.group.panes.activePane;
		f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight'); f.key(code, modifiers);
		const menu = f.editor.contextMenu; assert.equal(menu.visible, true);
		assert.ok(menu.invocationOrigin === strip.focusTarget && menu.returnFocus === strip.focusTarget);
		const index = menu.model.rows.findIndex(row => row.command === 'tabs.close'); assert.ok(index >= 0 && menu.model.rows[index].enabled);
		f.key('Home'); for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown'); f.key('Enter');
		assert.equal(menu.visible, false); assert.equal(f.group.model.contains(f.secondSource), false);
		assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane && pane!.input === f.firstInput);
		assert.ok(inputFocus.target === strip.focusTarget);
	});

test('Ctrl+W on the strip closes its inactive focused input without closing or reattaching the active Source', t => {
	const f = threeSources(t), strip = f.group.tabStrip, pane = f.group.panes.activePane, generation = f.group.panes.openGeneration;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight'); f.key('KeyW', KeyModifier.ctrl);
	assert.equal(f.group.model.contains(f.secondSource), false);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane && pane!.input === f.firstInput);
	assert.equal(f.group.panes.openGeneration, generation); assert.ok(inputFocus.target === strip.focusTarget);
});

test('Palette Keep Open pins the inactive focused preview without activating it or its Source pane', t => {
	const f = threeSources(t), strip = f.group.tabStrip, pane = f.group.panes.activePane;
	assert.ok(f.group.model.previewTab === f.third);
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('End'); palette(f, 'keepEditor');
	assert.equal(f.group.model.previewTab, null);
	assert.ok(strip.focusedInput === f.third && f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane);
});

test('Ctrl+S saves only the inactive focused Source and its canonical Undo remains available after activation', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = threeSources(t), strip = f.group.tabStrip;
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved active source\n' }]);
	f.secondSource.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- save this focused source\n' }]);
	const saved = f.secondSource.workingCopy.buffer.getText(), pane = f.group.panes.activePane;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight'); f.key('KeyS', KeyModifier.ctrl);
	const operation = f.ide.textFileSaves.latestOperation(f.secondSource.workingCopy);
	assert.ok(operation !== undefined); assert.equal((await operation.completion).status, 'saved');
	assert.ok([...files.records.values()].some(record => record.contents === saved), 'the exact focused authored source is persisted');
	assert.ok(f.ide.textFileSaves.latestOperation(f.firstInput.workingCopy) === undefined);
	assert.equal(f.firstInput.workingCopy.dirty, true); assert.equal(f.secondSource.workingCopy.dirty, false); assert.equal(f.secondSource.workingCopy.canUndo, true);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane && strip.focusedInput === f.secondSource);
	f.key('Enter'); f.key('Escape'); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(f.secondSource.workingCopy.buffer.getText(), f.otherSource); assert.equal(f.secondSource.workingCopy.canRedo, true);
});

test('Palette view-copy and move commands retain the strip focused editor rather than borrowing its active sibling', t => {
	const f = threeSources(t), parts = f.editor.editorParts, pane = f.group.panes.activePane;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	const windows = [...parts.documents]; palette(f, 'window.copyEditor');
	const created = parts.documents.find(part => !windows.includes(part)); assert.ok(created !== undefined);
	const view = created.activeGroup.model.activeTab;
	assert.ok(view instanceof CodeEditorInput && view !== f.secondSource && view.workingCopy === f.secondSource.workingCopy);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane);
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	palette(f, 'window.moveEditor'); const picker = f.editor.quickInput; assert.equal(picker.visible, true);
	type Item = QuickPickItem & { readonly destination: EditorMoveDestination };
	const index = picker.model.list.rows.findIndex(row => { const destination = (row.item as Item).destination;
		return destination.kind === 'group' && destination.group === parts.main.activeGroup; });
	assert.ok(index >= 0); f.key('Home', KeyModifier.ctrl); for (let row = 0; row < index; row++) f.key('ArrowDown'); f.key('Enter');
	assert.ok(parts.findGroup(f.secondSource) === parts.main.activeGroup);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane === pane);
});

test('navigation during an armed activation revokes it instead of activating either the old or newly focused tab', t => {
	const f = threeSources(t), strip = f.group.tabStrip;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none)); f.key('ArrowRight');
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false)); f.update();
	assert.ok(strip.focusedInput === f.third && f.group.model.activeTab === f.firstInput && f.group.panes.activePane?.input === f.firstInput);
});

test('blur cancels an armed tab activation and an unmatched repeated or released key cannot revive it', t => {
	const f = threeSources(t), strip = f.group.tabStrip;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none)); f.second.focus();
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false)); f.update();
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane?.input === f.firstInput);
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, true, true));
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false)); f.update();
	assert.ok(strip.focusedInput === f.secondSource && f.group.model.activeTab === f.firstInput);
});

test('a nonportable diagnostic is still a selectable tab and its pane retirement does not retire the strip', t => {
	const f = threeSources(t), strip = f.group.tabStrip, diagnostic = new HostErrorInput('fixture diagnostic');
	f.group.openEditor(diagnostic); f.group.activate(f.firstInput.id); f.update();
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('End');
	assert.equal(diagnostic.canMove(), false); assert.equal(strip.focusedInput === diagnostic && f.group.model.activeTab === f.firstInput, true);
	f.key('Enter'); assert.ok(f.group.model.activeTab === diagnostic && f.group.panes.activePane?.input === diagnostic);
	assert.ok(inputFocus.target === strip.focusTarget);
});

test('roving to and activating a Game tab never grants guest keys until its actual viewport is explicitly focused', t => {
	const f = threeSources(t), strip = f.group.tabStrip, game = new GameViewInput();
	f.group.openEditor(game); f.group.activate(f.firstInput.id); f.update();
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('End');
	assert.equal(strip.focusedInput === game && f.group.model.activeTab === f.firstInput, true); assert.equal(f.editor.guestInputRecipient, null);
	f.key('Enter'); assert.ok(f.group.model.activeTab === game && inputFocus.target === strip.focusTarget); assert.equal(f.editor.guestInputRecipient, null);
	f.key('Escape'); assert.ok(inputFocus.target === f.group.panes.activePane!.commandTarget); assert.equal(f.editor.guestInputRecipient, null);
	f.key('Tab'); const guest = inputFocus.target; assert.ok(guest?.guestInput !== undefined && f.editor.guestInputRecipient === f.host.input);
	f.key('ArrowLeft'); f.key('Tab'); assert.ok(inputFocus.target === guest && f.group.model.activeTab === game);
	f.key('F1', KeyModifier.shift); assert.equal(f.editor.guestInputRecipient, null);
});

test('reentering a tab strip preserves a newer concrete focus published while its previous subject retires', t => {
	const f = threeSources(t), strip = f.group.tabStrip;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	let redirected = false;
	const unbind = strip.focusTarget.scope.onDidRetireContext(() => { unbind(); redirected = true; f.second.focus(); }); t.after(unbind);
	assert.equal(strip.focus(), false);
	assert.equal(redirected, true); assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane?.input === f.firstInput);
});

for (const replace of [false, true]) test(`removing the roving editor ${replace ? 'and reusing its id ' : ''}while Palette is open revokes its command context`, t => {
	const f = threeSources(t);
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight'); f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.editor.quickInput.visible, true);
	f.group.removeEditor(f.secondSource);
	const replacement = replace ? new CodeEditorInput(f.secondSource.workingCopy) : undefined;
	if (replacement !== undefined) f.group.model.add(replacement);
	f.update();
	assert.equal(f.editor.quickInput.visible, false);
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false)); f.update();
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.model.contains(f.third));
	assert.equal(f.group.model.contains(f.secondSource), false);
	if (replacement !== undefined) assert.equal(f.group.model.contains(replacement), true);
});

test('reordering and publishing metadata for the same focused identity keeps its Palette context alive', t => {
	const f = threeSources(t), strip = f.group.tabStrip;
	f.editor.commands.execute('group.focusTabs', f.group.tabFocusTarget); f.key('ArrowRight');
	const generation = strip.focusTarget.scope.contextGeneration;
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift); assert.equal(f.editor.quickInput.visible, true);
	f.group.model.move(1, 2); f.secondSource.title = 'updated source metadata';
	f.secondSource.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- metadata publication\n' }]); f.update();
	assert.equal(f.editor.quickInput.visible, true); assert.ok(strip.focusedInput === f.secondSource);
	assert.equal(strip.focusTarget.scope.contextGeneration, generation);
	f.key('Escape'); assert.ok(inputFocus.target === strip.focusTarget && strip.focusedInput === f.secondSource);
	assert.ok(f.group.model.activeTab === f.firstInput && f.group.panes.activePane?.input === f.firstInput);
});

test('Tab from a strip without an actual toolbar item enters its current content instead of focusing hidden actions', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup, strip = group.tabStrip;
	f.editor.commands.execute('group.focusTabs', group.tabFocusTarget);
	assert.equal(strip.actions.items.some(item => item.visible && item.enabled && !item.overflowed), false);
	f.key('Tab'); assert.ok(inputFocus.target === group.panes.activePane!.commandTarget);
	assert.ok(group.model.activeTab === f.firstInput);
});

for (const hiddenBy of ['minimized window', 'maximized sibling'] as const)
	test(`Palette Focus Tabs reveals its captured Source group after a ${hiddenBy} without temporarily focusing content`, t => {
		const f = threeSources(t), parts = f.editor.editorParts, group = f.group, strip = group.tabStrip;
		const sibling = hiddenBy === 'maximized sibling' ? parts.splitGroup(group, 'right')! : undefined;
		if (sibling !== undefined) sibling.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
		group.focus(); f.update();
		const pane = group.panes.activePane!;
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		const picker = f.editor.quickInput;
		assert.equal(picker.visible, true); assert.ok(picker.invocationOrigin === pane.commandTarget);
		const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'group.focusTabs');
		assert.ok(index >= 0);
		let contentFocused = 0;
		const unbind = pane.commandTarget.onDidFocus(() => { contentFocused++; }); t.after(unbind);
		if (sibling === undefined) {
			parts.minimize(f.firstPart); assert.equal(f.firstPart.window!.model.minimized, true);
		} else {
			f.firstPart.arrangement.toggleMaximize(sibling); f.update();
			assert.equal(group.presented, false);
		}
		assert.equal(picker.visible, true);
		f.key('Home', KeyModifier.ctrl); for (let row = 0; row < index; row++) f.key('ArrowDown'); f.key('Enter');
		assert.equal(picker.visible, false); assert.equal(f.firstPart.window!.model.minimized, false);
		assert.ok(f.firstPart.arrangement.maximized === undefined && group.presented);
		assert.ok(parts.activePart === f.firstPart && parts.activeGroup === group && inputFocus.target === strip.focusTarget);
		assert.ok(strip.focusedInput === f.firstInput && group.panes.activePane === pane && pane.input === f.firstInput);
		assert.equal(contentFocused, 0); assert.equal(f.editor.guestInputRecipient, null);
	});
