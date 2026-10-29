import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { CodeEditorInputSerializer } from '../../ide/workbench/contrib/code_editor/editor_serializer';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { resolveCodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

test('new Source views keep authored rows intact until wrapping is explicitly enabled', t => {
	const f = createActualSourcePanes(t, false, [['long.lua', `local long_value = '${'authored_'.repeat(80)}'\nreturn long_value`]]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'long.lua' })!;
	const input = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.firstGroup.openEditor(input, { pinned: true }); f.update();
	const code = f.first.code;
	assert.equal(code.view.wordWrapEnabled, false);
	assert.equal(code.layout.getVisualLineCount(), input.workingCopy.buffer.getLineCount());
	resolveCodeAreaViewport(code);
	assert.equal(code.geometry.codeHorizontalScrollbarVisible, true);
	f.first.focus(); f.editor.commands.execute('wrap', f.first.commandTarget); f.update();
	assert.equal(code.view.wordWrapEnabled, true);
	assert.ok(code.layout.getVisualLineCount() > input.workingCopy.buffer.getLineCount());
	assert.equal(input.workingCopy.dirty, false); assert.equal(input.workingCopy.canUndo, false);
});

test('Source tabs retain independent wrapping while reusing the same code control', t => {
	const f = createActualSourcePanes(t), commands = f.editor.commands;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	const other = new CodeEditorInput(f.secondInput.workingCopy);
	f.firstGroup.openEditor(other, { pinned: true });
	assert.ok(f.firstGroup.panes.activePane === f.first && f.first.input === other);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), false);
	f.firstGroup.activate(f.firstInput.id);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.firstInput.workingCopy.dirty, false); assert.equal(other.workingCopy.dirty, false);
});

for (const placement of ['split', 'window', 'group'] as const) test(`moving Source to another ${placement} retains its wrapping`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, commands = f.editor.commands;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	const model = f.firstInput.workingCopy, version = model.version;
	const destination = placement === 'split' ? { kind: 'split' as const, group: f.secondGroup, direction: 'right' as const }
		: placement === 'window' ? { kind: 'window' as const } : { kind: 'group' as const, group: f.secondGroup };
	assert.equal(parts.moveEditor(f.firstGroup, f.firstInput, destination), true);
	const group = parts.findGroup(f.firstInput)!;
	assert.ok(group.model.activeTab === f.firstInput && group.panes.activePane instanceof CodeEditorPane);
	assert.equal(commands.isActive('wrap', group.panes.activePane.commandTarget), true);
	assert.equal(model.version, version); assert.equal(model.dirty, false); assert.equal(model.canUndo, false);
});

test('Open Editor in New Window copies initial wrapping then retains independent view preferences', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, commands = f.editor.commands;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	commands.execute('window.copyEditor', f.first.commandTarget); await setImmediate(); f.update();
	const group = parts.activeGroup, input = group.model.activeTab, pane = group.panes.activePane!;
	assert.ok(input instanceof CodeEditorInput && input !== f.firstInput && input.workingCopy === f.firstInput.workingCopy);
	assert.equal(commands.isActive('wrap', pane.commandTarget), true);
	commands.execute('wrap', pane.commandTarget);
	assert.equal(commands.isActive('wrap', pane.commandTarget), false);
	f.first.focus(); assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(input.workingCopy.dirty, false); assert.equal(input.workingCopy.canUndo, false);
});

test('moving a whole Source group retains its input-owned wrapping in a fresh host', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, commands = f.editor.commands;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	assert.equal(parts.moveGroup(f.firstGroup, { kind: 'window' }), true);
	const group = parts.findGroup(f.firstInput)!;
	assert.ok(group.model.activeTab === f.firstInput && group.panes.activePane instanceof CodeEditorPane);
	assert.equal(commands.isActive('wrap', group.panes.activePane.commandTarget), true);
});

test('coalescing Source views preserves the retained receiver wrapping rather than the retired source preference', t => {
	const f = createActualSourcePanes(t, true), commands = f.editor.commands;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	assert.equal(f.editor.editorParts.moveEditor(f.firstGroup, f.firstInput, { kind: 'group', group: f.secondGroup }), true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.second.input === f.secondInput);
	assert.equal(commands.isActive('wrap', f.second.commandTarget), false);
});

test('a mode-only wrap toggle publishes a view-state change without editing its canonical model', t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy, version = model.version;
	f.first.focus();
	let changed = 0;
	t.after(f.first.code.onDidChangeViewState(() => changed++));
	f.editor.commands.execute('wrap', f.first.commandTarget);
	assert.ok(changed > 0);
	assert.equal(model.version, version); assert.equal(model.canUndo, false); assert.equal(model.dirty, false);
});

test('closing and reopening a Source restores its group view memento rather than the intervening tab preference', t => {
	const f = createActualSourcePanes(t), commands = f.editor.commands, model = f.firstInput.workingCopy;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	const other = new CodeEditorInput(f.secondInput.workingCopy);
	f.firstGroup.openEditor(other, { pinned: true });
	f.firstGroup.removeEditor(f.firstInput);
	const reopened = new CodeEditorInput(model);
	f.firstGroup.openEditor(reopened, { pinned: true });
	assert.ok(f.first.input === reopened);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(model.dirty, false);
});

test('Source serializer restores wrapping onto the same canonical model in a fresh control', async t => {
	const f = createActualSourcePanes(t), commands = f.editor.commands;
	f.first.focus(); commands.execute('wrap', f.first.commandTarget);
	const serializer = new CodeEditorInputSerializer(f.sources.catalog);
	const restored = await serializer.deserialize(serializer.serialize(f.firstInput));
	const document = f.editor.editorParts.createDocument(); document.activeGroup.openEditor(restored);
	assert.ok(restored !== f.firstInput && restored.workingCopy === f.firstInput.workingCopy);
	assert.equal(commands.isActive('wrap', document.activeGroup.panes.activePane!.commandTarget), true);
	assert.equal(restored.workingCopy.dirty, false);
});

test('navigation bookmarks and text Undo do not restore an earlier wrapping preference', t => {
	const f = createActualSourcePanes(t), commands = f.editor.commands, model = f.firstInput.workingCopy;
	f.first.focus();
	const selection = new CodeEditorNavigationSelection(f.firstInput); t.after(() => selection.dispose());
	commands.execute('wrap', f.first.commandTarget);
	selection.restore(f.firstInput, f.first.code);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.first.code.focusTarget.textInput!.replaceText(0, 0, '-- draft\n'), true);
	commands.execute('undo', f.first.commandTarget);
	assert.equal(model.buffer.getText(), f.source);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
});

test('Back and Forward restore Source locations without reverting a later wrap toggle', async t => {
	const f = createActualSourcePanes(t), commands = f.editor.commands;
	f.first.focus(); resetNavigationHistoryState();
	assert.equal(f.firstGroup.activate(f.firstInput.id, { selection: { row: 1, startColumn: 3, endColumn: 3 } }), true);
	commands.execute('wrap', f.first.commandTarget);
	await f.editor.navigation.goBackward();
	assert.equal(f.firstInput.context.view.cursorRow, 0); assert.equal(f.firstInput.context.view.cursorColumn, 0);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	await f.editor.navigation.goForward();
	assert.equal(f.firstInput.context.view.cursorRow, 1); assert.equal(f.firstInput.context.view.cursorColumn, 3);
	assert.equal(commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.firstInput.workingCopy.dirty, false);
});

const LONG_SOURCE = Array.from({ length: 80 }, (_, row) => `-- ${row} ${'wide reading position '.repeat(12)}`).join('\n');

test('cross-mode history reveals its canonical source caret instead of restoring wrapped viewport rows', async t => {
	const f = createActualSourcePanes(t, false, [['long.lua', LONG_SOURCE]]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'long.lua' })!;
	const input = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	input.context.view.wordWrapEnabled = true;
	f.firstGroup.openEditor(input, { pinned: true }); f.update();
	f.firstGroup.activate(input.id, { selection: { row: 60, startColumn: 120, endColumn: 120 } });
	resetNavigationHistoryState();
	f.firstGroup.activate(f.firstInput.id);
	f.firstGroup.activate(input.id);
	f.editor.commands.execute('wrap', f.first.commandTarget);
	await f.editor.navigation.goBackward();
	await f.editor.navigation.goBackward();
	assert.ok(f.first.input === input); assert.equal(input.context.view.wordWrapEnabled, false);
	assert.equal(input.context.view.cursorRow, 60); assert.equal(input.context.view.cursorColumn, 120);
	// Navigation's caret-reveal contract is expressed in the receiving layout, not fixed screen coordinates.
	const viewport = resolveCodeAreaViewport(f.first.code), view = input.context.view;
	const visual = f.first.code.layout.positionToVisualIndex(view.cursorRow, view.cursorColumn);
	assert.ok(visual >= view.scrollRow && visual < view.scrollRow + viewport.rows);
	const caret = f.first.code.nativeText.caretRect(); assert.ok(caret.width > 0 && caret.height > 0);
	assert.equal(input.workingCopy.dirty, false);
});

test('coalescing views with opposite wrapping reveals the source caret in the retained receiver layout', t => {
	const f = createActualSourcePanes(t, false, [['long.lua', LONG_SOURCE]]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'long.lua' })!;
	const source = resolveLuaCodeEditorInput(f.sources.catalog, resource), receiver = new CodeEditorInput(source.workingCopy);
	source.context.view.wordWrapEnabled = receiver.context.view.wordWrapEnabled = true;
	f.firstGroup.openEditor(source, { pinned: true }); f.secondGroup.openEditor(receiver, { pinned: true }); f.update();
	f.second.focus(); f.editor.commands.execute('wrap', f.second.commandTarget);
	f.firstGroup.activate(source.id, { selection: { row: 60, startColumn: 120, endColumn: 120 } });
	assert.equal(f.editor.editorParts.moveEditor(f.firstGroup, source, { kind: 'group', group: f.secondGroup }), true);
	assert.ok(f.second.input === receiver); assert.equal(receiver.context.view.wordWrapEnabled, false);
	assert.equal(receiver.context.view.cursorRow, 60); assert.equal(receiver.context.view.cursorColumn, 120);
	// Coalescence transfers text selection, not another view's layout-specific scroll coordinates.
	const viewport = resolveCodeAreaViewport(f.second.code), view = receiver.context.view;
	const visual = f.second.code.layout.positionToVisualIndex(view.cursorRow, view.cursorColumn);
	assert.ok(visual >= view.scrollRow && visual < view.scrollRow + viewport.rows);
	const caret = f.second.code.nativeText.caretRect(); assert.ok(caret.width > 0 && caret.height > 0);
	assert.equal(receiver.workingCopy.dirty, false);
});
