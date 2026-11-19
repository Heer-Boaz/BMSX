import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { NavigationHistoryEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createActualSourcePanes } from '../helpers/source_panes';

const ADDITIONAL_SOURCES = [['third.lua', 'local gamma = 3\nreturn gamma\n']] as const;

test('moving an inactive retained Source never admits, clears or rebinds the unrelated active source control', t => {
	const f = createActualSourcePanes(t, false, ADDITIONAL_SOURCES), parts = f.editor.editorParts, source = f.firstGroup;
	const input = resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	source.openEditor(input); input.context.view.cursorRow = 1; input.context.view.cursorColumn = 5;
	const reading = captureCodeEditorView(input);
	source.activate(f.firstInput.id); f.update(); source.focus();
	const pane = source.panes.activePane!, activeReading = captureCodeEditorView(f.firstInput);
	const commit = t.mock.method(source, 'commitPendingEdit', () => false);
	const clear = t.mock.method(source.panes, 'clearEditor'), attach = t.mock.method(source.panes, 'openEditor');
	const capture = t.mock.method(pane, 'getSelection');
	let disposed = 0; input.onWillDispose(() => { disposed++; });
	assert.equal(parts.canMoveEditor(source, input, { kind: 'group', group: f.secondGroup }), true);
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: f.secondGroup }), true);
	assert.equal(commit.mock.callCount(), 0); assert.equal(clear.mock.callCount(), 0); assert.equal(attach.mock.callCount(), 0);
	assert.equal(capture.mock.callCount(), 0); assert.equal(disposed, 0);
	assert.ok(source.model.activeTab === f.firstInput && source.panes.activePane === pane && pane.input === f.firstInput);
	assert.ok(parts.findGroup(input) === f.secondGroup && f.secondGroup.panes.activePane?.input === input);
	assert.deepEqual(captureCodeEditorView(input), reading); assert.deepEqual(captureCodeEditorView(f.firstInput), activeReading);
});

test('reordering an inactive tab retains the exact current source selection and control attachment', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const input = new CodeEditorInput(f.secondInput.workingCopy); source.openEditor(input); source.activate(f.firstInput.id); f.update();
	const pane = source.panes.activePane!;
	const clear = t.mock.method(source.panes, 'clearEditor'), attach = t.mock.method(source.panes, 'openEditor');
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: source, index: 0 }), true);
	assert.ok(source.model.tabs[0] === input && source.model.tabs[1] === f.firstInput);
	assert.ok(source.model.activeTab === f.firstInput && source.panes.activePane === pane && pane.input === f.firstInput);
	assert.equal(clear.mock.callCount(), 0); assert.equal(attach.mock.callCount(), 0);
});

test('coalescing an inactive Source follows its exact history without copying the active source view selection', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
	f.secondInput.context.view.cursorRow = 1; f.secondInput.context.view.cursorColumn = 2;
	const receivingReading = captureCodeEditorView(f.secondInput);
	const active = resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'second.lua' })!);
	source.openEditor(active); active.context.view.cursorRow = 1; active.context.view.cursorColumn = 7; f.update();
	const pane = source.panes.activePane!, activeReading = captureCodeEditorView(active);
	const capture = t.mock.method(pane, 'getSelection'), clear = t.mock.method(source.panes, 'clearEditor');
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const entry = new NavigationHistoryEntry({ kind: 'input', input: f.firstInput }, new CodeEditorNavigationSelection(f.firstInput), source);
	navigationState.back.push(entry);
	let disposed = 0; f.firstInput.onWillDispose(() => { disposed++; });
	assert.equal(parts.moveEditor(source, f.firstInput, { kind: 'group', group: target }), true);
	assert.equal(capture.mock.callCount(), 0); assert.equal(clear.mock.callCount(), 0); assert.equal(disposed, 1);
	assert.ok(source.model.activeTab === active && source.panes.activePane === pane && pane.input === active);
	assert.ok(target.model.activeTab === f.secondInput && target.panes.activePane?.input === f.secondInput);
	assert.ok(entry.owner === target && entry.target.kind === 'input' && entry.target.input === f.secondInput && !entry.isDisposed);
	assert.deepEqual(captureCodeEditorView(f.secondInput), receivingReading); assert.deepEqual(captureCodeEditorView(active), activeReading);
});

for (const phase of ['destination detach', 'history handoff', 'destination attachment'] as const)
test(`an independent admitted close during inactive ${phase} selects another source editor without restoring the old active input`, async t => {
	const f = createActualSourcePanes(t, false, ADDITIONAL_SOURCES), parts = f.editor.editorParts, source = f.firstGroup;
	const input = new CodeEditorInput(f.secondInput.workingCopy); source.openEditor(input);
	const successor = resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	source.openEditor(successor); source.model.move(source.model.indexOf(successor), 0); source.activate(f.firstInput.id); f.update();
	let closed: Promise<boolean> | undefined;
	let unbind = () => {};
	const close = () => { unbind(); closed = source.close(f.firstInput.id); };
	unbind = phase === 'destination detach' ? f.secondGroup.panes.onDidClearEditor(close)
		: phase === 'history handoff' ? source.onDidMoveEditor(close) : f.secondGroup.panes.onWillShowEditor(close);
	t.after(unbind);
	const attach = t.mock.method(source.panes, 'openEditor');
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: f.secondGroup }), true);
	assert.equal(await closed, true); assert.equal(attach.mock.callCount(), 1, 'only the independent close attaches its chosen successor');
	assert.ok(source.model.activeTab === successor && source.panes.activePane?.input === successor);
	assert.ok(!source.model.contains(input) && f.secondGroup.model.activeTab === f.secondInput && parts.findGroup(input) === undefined);
});

test('a new attachment of the requested inactive input supersedes its uncommitted transfer admission', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const input = new CodeEditorInput(f.secondInput.workingCopy); source.openEditor(input); source.activate(f.firstInput.id); f.update();
	let closed: Promise<boolean> | undefined;
	const unbind = f.secondGroup.panes.onDidClearEditor(() => { unbind(); closed = source.close(f.firstInput.id); }); t.after(unbind);
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: f.secondGroup }), false);
	assert.equal(await closed, true);
	assert.ok(source.model.contains(input) && source.model.activeTab === input && source.panes.activePane?.input === input);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane?.input === f.secondInput);
	assert.equal(parts.closeController.isPending(input), false);
});

test('retiring the destination revokes an inactive handoff without detaching or rebinding its live source control', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const input = new CodeEditorInput(f.secondInput.workingCopy); source.openEditor(input); source.activate(f.firstInput.id); f.update();
	const pane = source.panes.activePane!, clear = t.mock.method(source.panes, 'clearEditor'), attach = t.mock.method(source.panes, 'openEditor');
	const unbind = f.secondGroup.panes.onDidClearEditor(() => { unbind(); f.secondPart.window!.detach(); }); t.after(unbind);
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: f.secondGroup }), false);
	assert.ok(source.model.contains(input) && source.model.activeTab === f.firstInput && source.panes.activePane === pane && pane.input === f.firstInput);
	assert.equal(clear.mock.callCount(), 0); assert.equal(attach.mock.callCount(), 0);
	assert.equal(parts.closeController.isPending(input), false);
});

test('a newer actual source-control interaction during inactive destination attachment keeps focus and frontend routing', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const input = new CodeEditorInput(f.secondInput.workingCopy); source.openEditor(input); source.activate(f.firstInput.id); f.update();
	const pane = source.panes.activePane!; source.focus();
	const unbind = f.secondGroup.panes.onWillShowEditor(() => pane.focus()); t.after(unbind);
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: f.secondGroup }), true);
	assert.ok(source.model.activeTab === f.firstInput && source.panes.activePane === pane);
	assert.ok(inputFocus.target === pane.commandTarget && parts.activePart === f.firstPart && parts.activeGroup === source);
});

test('an exact nonmember input cannot borrow an inactive retained tab matching the same resource', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const retained = new CodeEditorInput(f.secondInput.workingCopy), absent = retained.createView();
	t.after(() => absent.dispose()); source.openEditor(retained); source.activate(f.firstInput.id);
	const documents = parts.documents.length, generation = source.panes.openGeneration;
	assert.equal(parts.canMoveEditor(source, absent, { kind: 'window' }), false);
	assert.equal(parts.moveEditor(source, absent, { kind: 'window' }), false);
	assert.equal(parts.documents.length, documents); assert.equal(source.panes.openGeneration, generation);
	assert.ok(source.model.contains(retained) && source.model.activeTab === f.firstInput && source.panes.activePane?.input === f.firstInput);
});
