import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createLuaTableFieldRemovalEdits } from '../../ide/language/lua/source_edits';

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant(font);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(f.firstGroup, resource); const input = f.firstGroup.model.activeTab; assert.ok(input instanceof SceneEditorInput);
	f.update(); const pane = f.firstGroup.panes.activePane!; assert.ok(pane instanceof SceneEditorPane); pane.focus();
	assert.equal(editorViewState.font.variant, font);
	return { ...f, pane, input, model: input.workingCopy };
}
type Fixture = ReturnType<typeof fixture>;
/** Coordinates only locate the actual outline row; workflow assertions concern source and owned selection. */
function secondary(f: Fixture, index: number, gutter = false): void {
	const tree = f.input.outline, row = tree.rows[index], layout = tree.layout;
	const x = layout.contentLeft + (row.depth + (gutter ? 0.5 : 1.5)) * layout.indentWidth;
	const y = layout.contentTop + (index - tree.scroll + 0.5) * layout.rowHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10); f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Secondary : 0,
			pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
}
function accept(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu, index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled);
	f.key('Home'); for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown'); f.key('Enter');
}

for (const font of ['tiny', 'msx'] as const) test(`${font} Scene secondary selects the exact row without expanding its disclosure or modifying canonical source`, t => {
	const f = fixture(t, font), root = f.input.outline.roots[0], initial = root.collapsed, source = f.model.buffer.getText(), version = f.model.version;
	selectSceneOutlineRow(f.input, 1); f.pane.update(); secondary(f, 0, true);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.input.outline.rows[f.input.outline.selectionIndex] === root);
	assert.equal(root.collapsed, initial); assert.equal(f.input.section, 'outline');
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	f.key('Escape'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === f.pane.commandTarget);
});

for (const code of ['ContextMenu', 'F10']) test(`Scene ${code} uses the selected authored member and returns to the exact invoking control on cancel`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input, 2); f.pane.update(); f.pane.focus();
	const origin = inputFocus.admittedTarget, selected = f.input.outline.rows[2];
	f.key(code, code === 'F10' ? KeyModifier.shift : KeyModifier.none);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.input.outline.rows[f.input.outline.selectionIndex] === selected);
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.removeMember' && row.enabled));
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === origin); assert.equal(f.model.canUndo, false);
});


for (const command of ['editor.source', 'editor.sourceToSide'] as const) test(`Scene context ${command} opens the exact selected canonical source without rewriting it`, async t => {
	const f = fixture(t); f.firstGroup.model.pin(f.input); selectSceneOutlineRow(f.input, 2); f.pane.update();
	const expected = f.pane.getSourceLocation!()!, source = f.model.buffer.getText(), version = f.model.version;
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	secondary(f, 2); accept(f, command); assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const group = command === 'editor.source' ? f.firstGroup : f.firstPart.groups.find(candidate => candidate !== f.firstGroup)!;
	const input = group.model.activeTab; assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.equal(input.context.view.cursorRow, expected.selection!.row); assert.equal(input.context.view.cursorColumn, expected.selection!.startColumn);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, false);
	if (command === 'editor.sourceToSide') assert.ok(f.firstGroup.model.activeTab === f.input && f.firstGroup.panes.activePane === f.pane);
});

test('Scene menu Details keeps the selected occurrence and its container owns keyboard menus, not property fields', t => {
	const f = fixture(t); secondary(f, 1); accept(f, 'sceneEditor.details');
	assert.equal(f.input.section, 'details'); const origin = inputFocus.admittedTarget;
	assert.ok(origin === f.pane.commandTarget && origin !== null);
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, true); f.key('Escape'); assert.ok(inputFocus.admittedTarget === origin);
	const field = f.pane.controls[0].field; field.focusTarget.focus(); const text = field.readText().text;
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === field.focusTarget);
	assert.equal(field.readText().text, text); assert.equal(f.model.canUndo, false);
});

test('Scene menu moves and removes authored members through canonical Undo and Save', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = fixture(t), before = f.model.buffer.getText();
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	secondary(f, 1); accept(f, 'sceneEditor.moveMemberDown');
	const moved = f.model.buffer.getText(); assert.ok(moved !== before); assert.equal(f.model.canUndo, true);
	assert.ok(moved.indexOf("member_id = 'source only'") < moved.indexOf("member_id = 'subject'"));
	f.editor.commands.execute('undo', f.pane.commandTarget); assert.equal(f.model.buffer.getText(), before); f.update();
	secondary(f, 2); accept(f, 'sceneEditor.removeMember');
	const removed = f.model.buffer.getText(); assert.ok(removed !== before && !removed.includes("member_id = 'source only'"));
	assert.equal(f.input.outline.selectionIndex, -1); assert.equal(f.model.canUndo, true);
	f.editor.commands.execute('save', f.pane.commandTarget);
	const operation = f.ide.textFileSaves.latestOperation(f.model); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved'); assert.equal(f.model.dirty, false); assert.equal(f.model.canUndo, true);
	assert.ok([...files.records.values()].some(record => record.contents === removed));
	f.editor.commands.execute('undo', f.pane.commandTarget); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.dirty, true);
});

for (const invalidation of ['selection', 'source', 'equal-source', 'attachment'] as const) test(`Scene menu is revoked by actual ${invalidation} retirement`, t => {
	const f = fixture(t), before = f.model.buffer.getText(); secondary(f, 1); assert.equal(f.editor.contextMenu.visible, true);
	if (invalidation === 'selection') selectSceneOutlineRow(f.input, 2);
	else if (invalidation === 'attachment') f.firstGroup.openEditor(new HostErrorInput('replacement'));
	else f.model.pushEditOperations([{ offset: 0, deleteLength: invalidation === 'equal-source' ? before.length : 0,
		text: invalidation === 'equal-source' ? before : '-- source publication\n' }]);
	assert.equal(f.editor.contextMenu.visible, false);
	const current = f.model.buffer.getText(); f.key('Enter'); assert.equal(f.model.buffer.getText(), current);
});

test('Scene menu cannot retarget an accepted remove when focus return selects another occurrence', t => {
	const f = fixture(t), before = f.model.buffer.getText(); secondary(f, 1);
	const origin = f.editor.contextMenu.returnFocus!; let changed = false;
	const unbind = origin.onDidFocus(() => { unbind(); changed = true; selectSceneOutlineRow(f.input, 2); }); t.after(unbind);
	accept(f, 'sceneEditor.removeMember'); assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.input.outline.selectionIndex, 2); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});

for (const change of ['foreign', 'rebind', 'reattach'] as const) test(`Scene physical secondary consumes its old row after ${change} focus callback`, t => {
	const f = fixture(t), before = f.model.buffer.getText(); selectSceneOutlineRow(f.input, 1); f.pane.update(); f.second.focus();
	let changed = false; const origin = f.pane.commandTarget;
	const unbind = origin.onDidFocus(() => {
		unbind(); changed = true;
		if (change === 'foreign') f.second.focus();
		else { f.firstGroup.openEditor(new HostErrorInput('replacement')); if (change === 'reattach') f.firstGroup.openEditor(f.input); }
	}); t.after(unbind);
	secondary(f, 2); assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.input.outline.selectionIndex, 1); assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
	if (change === 'foreign') assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('Scene selection publication describes coherent source bindings and ignores passive refresh or reselection', t => {
	const f = fixture(t); let changed = 0;
	t.after(f.input.onDidChangeSelection(() => {
		changed++; const row = f.input.outline.rows[f.input.outline.selectionIndex].element;
		assert.equal(f.input.selectionRange.start, row.span.start); assert.equal(f.input.selectionRange.end, row.span.end);
		assert.equal(f.input.properties[0].value, row.kind === 'member' && row.index === 0 ? 11 : null);
	}));
	selectSceneOutlineRow(f.input, 1); assert.equal(changed, 1); f.pane.update(); selectSceneOutlineRow(f.input, 1); assert.equal(changed, 1);
});

test('Scene secondary does not overwrite a newer selection made by its publication listener', t => {
	const f = fixture(t), before = f.model.buffer.getText();
	const unbind = f.input.onDidChangeSelection(() => { unbind(); selectSceneOutlineRow(f.input, 2); }); t.after(unbind);
	secondary(f, 1); assert.equal(f.input.outline.selectionIndex, 2); assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});


test('Scene menu retains its exact model mutation without stealing a newer foreign return focus', t => {
	const f = fixture(t), source = f.model.buffer.getText(), foreign = f.secondInput.workingCopy.buffer.getText(); secondary(f, 1);
	const origin = f.editor.contextMenu.returnFocus!; let changed = false;
	const unbind = origin.onDidFocus(() => { unbind(); changed = true; f.second.focus(); }); t.after(unbind);
	accept(f, 'sceneEditor.removeMember'); assert.equal(changed, true); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(f.model.buffer.getText() !== source && !f.model.buffer.getText().includes("member_id = 'subject'"));
	assert.equal(f.model.canUndo, true); assert.equal(f.secondInput.workingCopy.buffer.getText(), foreign);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	f.editor.commands.execute('undo', f.pane.commandTarget); assert.equal(f.model.buffer.getText(), source);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
});

test('Scene secondary consumes selection publication that establishes a newer foreign control', t => {
	const f = fixture(t), before = f.model.buffer.getText();
	const unbind = f.input.onDidChangeSelection(() => { unbind(); f.second.focus(); }); t.after(unbind);
	secondary(f, 1); assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.input.outline.selectionIndex, 1);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.canUndo, false);
});


for (const rebind of [false, true]) test(`Scene retained member command ${rebind ? 'rejects a draft publication that rebinds its attachment' : 'settles its actual focused draft before canonical mutation'}`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input, 1); f.pane.update();
	const commandTarget = f.pane.commandTarget; f.editor.commands.execute('sceneEditor.details', commandTarget);
	const field = f.pane.controls[0].field; field.focusTarget.focus();
	assert.equal(field.replaceText(0, field.readText().text.length, '77'), true); assert.equal(field.focusTarget.edit!.pending, true);
	let rebound = false;
	if (rebind) {
		const unbind = f.model.onDidChangeContent(() => { unbind(); rebound = true; f.firstGroup.openEditor(new HostErrorInput('newer attachment')); }); t.after(unbind);
	}
	f.editor.commands.execute('sceneEditor.moveMemberDown', commandTarget);
	const text = f.model.buffer.getText(); assert.equal(field.focusTarget.edit!.pending, false); assert.ok(text.includes('x = 77'));
	assert.equal(rebound, rebind); assert.equal(f.model.canUndo, true);
	assert.equal(text.indexOf("member_id = 'source only'") < text.indexOf("member_id = 'subject'"), !rebind);
	if (rebind) assert.ok(f.firstGroup.model.activeTab instanceof HostErrorInput);
});

test('Scene Details background secondary uses its selected member without treating its value field as an outline action', t => {
	const f = fixture(t); secondary(f, 1); accept(f, 'sceneEditor.details');
	const origin = f.pane.commandTarget, before = f.model.buffer.getText(), bounds = f.input.details.bounds;
	for (const down of [true, false]) f.editor.dispatchPointer({ x: bounds.left + 1, y: bounds.top + 1,
		buttons: down ? PointerButton.Secondary : 0, pressedButtons: down ? PointerButton.Secondary : 0,
		releasedButtons: down ? 0 : PointerButton.Secondary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.editor.contextMenu.invocationOrigin === origin);
	assert.equal(f.input.outline.selectionIndex, 1); f.key('Escape'); assert.ok(inputFocus.admittedTarget === origin); assert.equal(f.model.buffer.getText(), before);
});

for (const operation of ['update', 'setOptions', 'getSelection'] as const) test(`Scene ${operation} source rebuild stops its retired pane when selection publication opens another editor`, t => {
	const f = fixture(t); selectSceneOutlineRow(f.input, 1); f.pane.update();
	const navigation = f.pane.getSelection(); t.after(() => navigation.dispose());
	const selected = f.input.outline.rows[f.input.outline.selectionIndex].element;
	assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	const replacement = new HostErrorInput('replacement'); let publications = 0;
	const unbind = f.input.onDidChangeSelection(() => {
		unbind(); publications++;
		if (operation === 'getSelection') selectSceneOutlineRow(f.input, 0);
		f.firstGroup.openEditor(replacement);
	}); t.after(unbind);
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, f.input.parsed.locations, f.input.parsed.tokens, selected.entry.field));
	const edited = f.model.buffer.getText();
	assert.doesNotThrow(() => {
		if (operation === 'setOptions') f.pane.setOptions(undefined, navigation);
		else if (operation === 'getSelection') {
			const snapshot = f.pane.getSelection(); t.after(() => snapshot.dispose());
			const actual = f.input.outline.rows[f.input.outline.selectionIndex].element, captured = snapshot.snapshot.selected;
			assert.ok(captured !== undefined);
			assert.equal(captured.kind, actual.kind);
			assert.deepEqual(captured.span, actual.span);
			assert.deepEqual(captured.span, f.input.selectionRange);
		}
		else f.pane.update();
	});
	assert.equal(publications, 1); assert.ok(f.firstGroup.model.activeTab === replacement);
	assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane?.commandTarget);
	assert.equal(f.model.buffer.getText(), edited); assert.equal(f.model.canUndo, true);
});

test('Scene history restore stops its retired pane when the restored selection opens another editor', t => {
	const f = fixture(t), source = f.model.buffer.getText(); selectSceneOutlineRow(f.input, 1); f.pane.update();
	const navigation = f.pane.getSelection(); t.after(() => navigation.dispose());
	selectSceneOutlineRow(f.input, 2); f.pane.update();
	const replacement = new HostErrorInput('replacement'); let publications = 0;
	const unbind = f.input.onDidChangeSelection(() => {
		unbind(); publications++; f.firstGroup.openEditor(replacement);
	}); t.after(unbind);
	assert.doesNotThrow(() => f.pane.setOptions(undefined, navigation));
	assert.equal(publications, 1); assert.ok(f.firstGroup.model.activeTab === replacement);
	assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane?.commandTarget);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});
