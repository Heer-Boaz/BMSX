import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { showGroupOpenEditors, showOpenEditors } from '../../ide/workbench/services/editor/open_editors';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import type { EditorInput } from '../../ide/workbench/ui/tab/model';
import { createActualSourcePanes } from '../helpers/source_panes';

function selectInput(f: ReturnType<typeof createActualSourcePanes>, input: EditorInput): void {
	const picker = f.editor.quickInput;
	const index = picker.model.list.rows.findIndex(row => (row.item as QuickPickItem & { input: EditorInput }).input === input);
	assert.ok(index >= 0, 'the retained input is reachable in workspace navigation');
	picker.model.list.selectionIndex = index;
	f.key('Enter');
}

test('workspace Open Editors reveals inactive tabs in their exact group and retained background or minimized host', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const main = parts.main.activeGroup;
	const mainInput = new CodeEditorInput(f.firstInput.workingCopy);
	main.openEditor(mainInput);
	const side = parts.splitGroup(main, 'right'), sideInput = new CodeEditorInput(f.secondInput.workingCopy);
	side.openEditor(sideInput);
	const home = new HomeInput(null); side.openEditor(home);
	f.update();
	parts.minimize(f.firstPart);
	f.secondPart.window!.setPlacement('maximized'); f.secondPart.focus();
	const before = parts.groups.reduce((count, group) => count + group.model.tabs.length, 0), hosts = parts.documents.length;
	showOpenEditors(parts, f.editor.quickInput);
	assert.equal(f.editor.quickInput.model.list.rows.length, before);
	selectInput(f, sideInput);
	assert.equal(parts.activePart, parts.main); assert.equal(parts.activeGroup, side);
	assert.equal(side.model.activeTab, sideInput); assert.equal(side.panes.activePane!.input, sideInput);
	assert.ok(side.model.tabs.includes(home), 'revealing a retained inactive tab does not retire its sibling');
	assert.equal(f.secondPart.window!.model.placement, 'maximized');
	assert.equal(f.secondGroup.model.activeTab, f.secondInput);
	showOpenEditors(parts, f.editor.quickInput); selectInput(f, f.firstInput);
	assert.equal(parts.activePart, f.firstPart); assert.equal(parts.activeGroup, f.firstGroup);
	assert.equal(f.firstPart.window!.model.minimized, false);
	assert.equal(f.firstGroup.model.activeTab, f.firstInput);
	assert.equal(parts.documents.length, hosts);
	assert.equal(parts.groups.reduce((count, group) => count + group.model.tabs.length, 0), before);
});

test('tab overflow enumerates only its own group while workspace navigation includes sibling groups', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const main = parts.main.activeGroup;
	const input = new CodeEditorInput(f.firstInput.workingCopy); main.openEditor(input);
	const side = parts.splitGroup(main, 'right'), other = new CodeEditorInput(f.secondInput.workingCopy); side.openEditor(other);
	showGroupOpenEditors(main, f.editor.quickInput);
	assert.equal(f.editor.quickInput.model.list.rows.length, main.model.tabs.length);
	assert.equal(f.editor.quickInput.model.list.rows.some(row => (row.item as QuickPickItem & { input: EditorInput }).input === other), false);
	selectInput(f, input);
	assert.equal(parts.activeGroup, main); assert.equal(main.model.activeTab, input);
	showOpenEditors(parts, f.editor.quickInput);
	assert.equal(f.editor.quickInput.model.list.rows.some(row => (row.item as QuickPickItem & { input: EditorInput }).input === other), true);
	selectInput(f, other); assert.equal(parts.activeGroup, side);
});

test('workspace navigation reveals a group hidden by Group Maximize before focusing its retained editor', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main.activeGroup;
	main.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const side = parts.splitGroup(main, 'down'), wanted = new CodeEditorInput(f.secondInput.workingCopy);
	side.openEditor(wanted); parts.main.arrangement.toggleMaximize(main); main.panes.activePane!.focus(); f.update();
	assert.equal(parts.main.arrangement.maximized, main);
	assert.equal(parts.main.arrangement.leaves.find(leaf => leaf.group === side)!.visible, false);
	showOpenEditors(parts, f.editor.quickInput); selectInput(f, wanted);
	assert.equal(parts.activeGroup, side); assert.equal(parts.main.arrangement.maximized, undefined);
	assert.equal(parts.main.arrangement.leaves.find(leaf => leaf.group === side)!.visible, true);
	assert.equal(side.panes.activePane!.input, wanted);
	assert.equal(inputFocus.target, side.panes.activePane!.commandTarget);
});

test('workspace editor choices are revoked when their actual tab membership changes', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	showOpenEditors(parts, f.editor.quickInput);
	assert.equal(f.editor.quickInput.visible, true);
	f.firstGroup.removeEditor(f.firstInput);
	assert.equal(f.editor.quickInput.visible, false);
	assert.equal(f.firstGroup.model.tabs.includes(f.firstInput), false);
	assert.equal(f.secondGroup.model.activeTab, f.secondInput);
});

test('part arrangement persistence retains real group topology, view state, active group and canonical source without schema versions', async t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, main = parts.main.activeGroup;
	const initial = new CodeEditorInput(f.firstInput.workingCopy); main.openEditor(initial);
	const right = parts.splitGroup(main, 'right'), rightInput = new CodeEditorInput(f.firstInput.workingCopy);
	right.openEditor(rightInput);
	const below = parts.splitGroup(right, 'down'), belowInput = new CodeEditorInput(f.secondInput.workingCopy);
	below.openEditor(belowInput);
	parts.main.arrangement.splits[0].split.ratio = 0.6;
	parts.main.arrangement.splits[1].split.ratio = 0.4;
	belowInput.context.view.cursorRow = 1; belowInput.context.view.cursorColumn = 2;
	below.panes.activePane!.focus(); f.update();
	parts.main.arrangement.toggleMaximize(below); f.update();
	const model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained canonical edit\n' }]);
	const source = model.buffer.getText(), version = model.version;
	const previousInputs = parts.groups.flatMap(group => [...group.model.tabs]);
	const saved = parts.serialize(f.editor.editorInputSerializers);
	assert.equal(parts.serialize(f.editor.editorInputSerializers, saved), saved, 'unchanged group subtrees retain immutable mementos');
	assert.equal(saved.main.layout.kind, 'split'); assert.equal(Object.hasOwn(saved, 'version'), false);
	assert.equal(Object.hasOwn(saved.main, 'version'), false);
	parts.clear(); await parts.restore(saved, f.editor.editorInputSerializers); f.update();
	assert.equal(parts.main.groups.length, 3);
	assert.equal(parts.main.activeGroup, parts.main.groups[saved.main.active]);
	assert.equal(parts.main.arrangement.maximized, parts.main.groups[saved.main.maximized!.group]);
	for (const group of parts.main.groups) {
		const input = group.model.activeTab!;
		assert.ok(input instanceof CodeEditorInput); assert.equal(input.workingCopy, model);
		assert.equal(previousInputs.includes(input), false, 'restore reconstructs a view, not an old control capability');
	}
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, true);
	assert.deepEqual(parts.serialize(f.editor.editorInputSerializers), saved);
});

// These are layout memento values, not a screen-position assertion: temporary
// Group Maximize must not overwrite the normal arrangement's viewport intent.
test('part serialization separates normal overflow scrolling from the maximized leaf viewport', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main.activeGroup;
	main.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const side = parts.splitGroup(main, 'right'); side.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.update();
	const arrangement = parts.main.arrangement;
	const viewport = { left: 0, top: 0, right: main.minimumWidth / 2, bottom: main.minimumHeight / 2 };
	arrangement.layout(viewport);
	arrangement.setScroll(arrangement.maxScrollX / 2, arrangement.maxScrollY / 2); arrangement.layout(viewport);
	const normal = { x: arrangement.scrollX, y: arrangement.scrollY };
	assert.ok(normal.x > 0 && normal.y > 0);
	arrangement.toggleMaximize(side); arrangement.layout(viewport);
	arrangement.setScroll(arrangement.maxScrollX, arrangement.maxScrollY); arrangement.layout(viewport);
	const maximized = { x: arrangement.scrollX, y: arrangement.scrollY };
	const saved = parts.serialize(f.editor.editorInputSerializers);
	assert.equal(saved.main.scrollX, normal.x); assert.equal(saved.main.scrollY, normal.y);
	assert.deepEqual(saved.main.maximized, { group: parts.main.groups.indexOf(side), scrollX: maximized.x, scrollY: maximized.y });
	assert.equal(parts.serialize(f.editor.editorInputSerializers, saved), saved);
	arrangement.toggleMaximize(side); arrangement.layout(viewport);
	assert.equal(arrangement.scrollX, normal.x); assert.equal(arrangement.scrollY, normal.y);
});
