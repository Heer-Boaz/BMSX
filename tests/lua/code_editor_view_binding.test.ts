import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorEditStateType } from '../../ide/editor/model/edit_state';
import { CodeEditorViewBinding } from '../../ide/editor/ui/code_editor_view_binding';
import { activeCodeEditor, codeEditorEditState, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { undo as undoSource, redo as redoSource } from '../../ide/editor/editing/undo_controller';
import { applyViewportSize, configureFontVariant } from '../../ide/editor/ui/view/view';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { inputFocus } from '../../ide/input/focus';

const resource = { location: { kind: 'workspace' as const, path: 'positions.lua' }, domain: 0 as const, path: 'positions.lua', source: { resid: 'positions.lua', type: 'lua' as const } };

test('external model edits track an unattached code cursor, oriented selection and visual scroll without changing text again', t => {
	const model = new EditorTextModel(resource, 'lua', 'header\nabcdef\ntail');
	const view = createCodeEditorViewState();
	view.cursorRow = 1; view.cursorColumn = 5;
	setSingleCursorSelectionAnchor(view, 1, 1);
	view.scrollRow = 70; // Wrapped visual rows are not buffer rows.
	const binding = new CodeEditorViewBinding(model, view);
	t.after(() => { binding.dispose(); model.dispose(); });
	let events = 0;
	model.onDidChangeContent(() => events += 1);
	const prefix = '-- 🐉\r\n';
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	assert.equal(view.cursorRow, 2); assert.equal(view.cursorColumn, 5);
	assert.deepEqual(view.selectionAnchor, { row: 2, column: 1 });
	assert.equal(view.scrollRow, 70);
	model.undo(); model.redo();
	assert.equal(view.cursorRow, 2); assert.equal(view.cursorColumn, 5);
	assert.deepEqual(view.selectionAnchor, { row: 2, column: 1 });
	assert.equal(events, 3); assert.equal(model.version, 4);
	assert.equal(model.buffer.getText(), prefix + 'header\nabcdef\ntail');
	// A whole-document replacement cannot leave a hidden cursor at a removed line.
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'x' }]);
	assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 0);
	assert.equal(getSingleCursorSelectionRange(view), null);
	model.restoreDirtySource('');
	assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 0);
	model.revert();
	assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 0);
	assert.equal(events, 6);
});

test('selection edge affinity excludes new text, in either direction, and an empty anchor remains a cursor', t => {
	for (const reverse of [false, true]) {
		const model = new EditorTextModel(resource, 'lua', 'abcdef');
		const view = createCodeEditorViewState();
		view.cursorColumn = reverse ? 1 : 5;
		setSingleCursorSelectionAnchor(view, 0, reverse ? 5 : 1);
		const binding = new CodeEditorViewBinding(model, view);
		t.after(() => { binding.dispose(); model.dispose(); });
		model.pushEditOperations([{ offset: 1, deleteLength: 0, text: 'L' }, { offset: 5, deleteLength: 0, text: 'R' }]);
		assert.equal(view.cursorColumn, reverse ? 2 : 6);
		assert.equal(view.selectionAnchor.column, reverse ? 6 : 2);
		assert.equal(model.buffer.getTextRange(2, 6), 'bcde');
		model.undo();
		assert.equal(view.cursorColumn, reverse ? 1 : 5);
		assert.equal(view.selectionAnchor.column, reverse ? 5 : 1);
		setSingleCursorSelectionAnchor(view, 0, view.cursorColumn);
		const cursor = view.cursorColumn;
		model.pushEditOperations([{ offset: cursor, deleteLength: 0, text: 'new' }]);
		assert.equal(view.cursorColumn, cursor);
		assert.equal(getSingleCursorSelectionRange(view), null);
	}
});

test('the old-buffer boundary fires once per atomic edit, including coalesced multi-operation edits and history', t => {
	const model = new EditorTextModel(resource, 'lua', 'abc');
	const view = createCodeEditorViewState();
	view.cursorColumn = 3;
	const binding = new CodeEditorViewBinding(model, view);
	t.after(() => { binding.dispose(); model.dispose(); });
	const before: string[] = [];
	const after: string[] = [];
	model.onWillChangeContent(() => before.push(model.buffer.getText()));
	model.onDidChangeContent(() => after.push(model.buffer.getText()));
	const foreignState = new EditorEditStateType<string>();
	model.prepareUndo('fixture', true, 1, foreignState.of('before'));
	model.applyUndoableReplace(0, 0, 'X');
	model.applyUndoableReplace(1, 0, 'Y');
	model.commitEdit(foreignState.of('after'), null);
	assert.equal(view.cursorColumn, 5);
	model.prepareUndo('fixture', true, 2, foreignState.of('before'));
	model.applyUndoableReplace(0, 0, 'Z');
	model.commitEdit(foreignState.of('after'), null);
	assert.equal(view.cursorColumn, 6);
	model.undo(); assert.equal(view.cursorColumn, 3);
	model.redo(); assert.equal(view.cursorColumn, 6);
	assert.deepEqual(before, ['abc', 'XYabc', 'ZXYabc', 'abc']);
	assert.deepEqual(after, ['XYabc', 'ZXYabc', 'abc', 'ZXYabc']);
	model.prepareUndo('empty', false, 3, foreignState.of('empty'));
	model.applyUndoableReplace(0, 0, '');
	assert.equal(model.commitEdit(foreignState.of('empty'), null), false);
	model.pushEditOperations([]);
	assert.equal(before.length, 4); assert.equal(after.length, 4);
});

test('an explicit Source history receiver restores text selection without restoring old layout coordinates', t => {
	const model = new EditorTextModel(resource, 'lua', 'abc');
	const view = createCodeEditorViewState();
	view.scrollRow = 7.25; view.scrollLeft = 19.75;
	const binding = new CodeEditorViewBinding(model, view);
	t.after(() => { binding.dispose(); model.dispose(); });
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 1, selectionAnchor: null }, view.editSource);
	const after = codeEditorEditState.of({ ...before.value, cursorRow: 1, cursorColumn: 3 }, view.editSource);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '\n' }], before, () => after);
	assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 3);
	assert.equal(view.scrollRow, 7.25); assert.equal(view.scrollLeft, 19.75);
	model.undo(view.editSource); assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 1);
	assert.equal(view.scrollRow, 7.25); assert.equal(view.scrollLeft, 19.75);
	model.redo(view.editSource); assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 3);
	assert.equal(view.scrollRow, 7.25); assert.equal(view.scrollLeft, 19.75);
	model.pushEditOperations([{ offset: 0, deleteLength: 1, text: '' }]);
	assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 3);
});

test('history capture treats wrapped scroll rows as view coordinates, not text positions', t => {
	const model = new EditorTextModel(resource, 'lua', 'local very_long_line = 123456789');
	const input = new CodeEditorInput(model), view = input.context.view;
	view.cursorColumn = 6; view.scrollRow = 5; view.scrollLeft = 10.25;
	const selection = new CodeEditorNavigationSelection(input);
	t.after(() => { selection.dispose(); input.dispose(); model.dispose(); });
	assert.equal(selection.snapshot.cursor, 6); assert.equal(selection.snapshot.scrollRow, 5); assert.equal(selection.snapshot.scrollLeft, 10.25);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉\n' }]);
	assert.equal(selection.snapshot.cursor, 12); assert.equal(selection.snapshot.scrollRow, 5); assert.equal(selection.snapshot.scrollLeft, 10.25);
});

test('Source Undo and Redo deliver recorded selections only to the invoking view before notifying observers', t => {
	const { models, documents } = createTestCodeDocuments(t);
	const model = models.retain(resource, 'lua', 'abcdefghij');
	const origin = createCodeEditorViewState(), invoking = createCodeEditorViewState();
	origin.cursorColumn = 3; origin.scrollRow = 70; origin.scrollLeft = 41.5;
	const originBinding = new CodeEditorViewBinding(model, origin), invokingBinding = new CodeEditorViewBinding(model, invoking);
	t.after(() => {
		inputFocus.setTarget(null); activeCodeEditor.detach();
		originBinding.dispose(); invokingBinding.dispose();
	});
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 3, selectionAnchor: { row: 0, column: 1 } }, origin.editSource);
	const after = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 4, selectionAnchor: null }, origin.editSource);
	model.pushEditOperations([{ offset: 3, deleteLength: 0, text: 'X' }], before, () => after);
	origin.cursorColumn = 11;
	activeCodeEditor.attach(model, invoking);
	configureFontVariant('tiny', documents.get(model));
	applyViewportSize({ width: 384, height: 288 }); refreshWorkbenchLayout();
	activeCodeEditor.focusTarget.focus();
	const seen: [string, number, number][] = [];
	model.onDidChangeContent(event => seen.push([event.kind, origin.cursorColumn, invoking.cursorColumn]));

	undoSource();
	assert.equal(model.buffer.getText(), 'abcdefghij');
	assert.equal(origin.cursorColumn, 10); assert.equal(origin.selectionAnchor, null);
	assert.equal(invoking.cursorColumn, 3); assert.deepEqual(invoking.selectionAnchor, { row: 0, column: 1 });
	assert.equal(origin.scrollRow, 70); assert.equal(origin.scrollLeft, 41.5);
	assert.equal(invoking.scrollRow, 0); assert.equal(invoking.scrollLeft, 0);
	redoSource();
	assert.equal(model.buffer.getText(), 'abcXdefghij');
	assert.equal(origin.cursorColumn, 11); assert.equal(origin.selectionAnchor, null);
	assert.equal(invoking.cursorColumn, 4); assert.equal(invoking.selectionAnchor, null);
	assert.equal(origin.scrollRow, 70); assert.equal(origin.scrollLeft, 41.5);
	assert.equal(invoking.scrollRow, 0); assert.equal(invoking.scrollLeft, 0);
	assert.deepEqual(seen, [['undo', 10, 3], ['redo', 11, 4]]);
});

test('programmatic model history maps both Source views without restoring the originating selection or scroll', t => {
	const model = new EditorTextModel(resource, 'lua', 'abcdef');
	const origin = createCodeEditorViewState(), sibling = createCodeEditorViewState();
	origin.scrollRow = 7; origin.scrollLeft = 13;
	sibling.cursorColumn = 6; sibling.scrollRow = 70; sibling.scrollLeft = 41.5;
	const originBinding = new CodeEditorViewBinding(model, origin), siblingBinding = new CodeEditorViewBinding(model, sibling);
	t.after(() => { originBinding.dispose(); siblingBinding.dispose(); model.dispose(); });
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 1, selectionAnchor: { row: 0, column: 0 } }, origin.editSource);
	const after = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 3, selectionAnchor: null }, origin.editSource);
	model.pushEditOperations([{ offset: 1, deleteLength: 0, text: 'X' }], before, () => after);
	assert.equal(origin.cursorColumn, 3); assert.equal(sibling.cursorColumn, 7);
	model.undo();
	assert.equal(origin.cursorColumn, 2); assert.equal(origin.selectionAnchor, null);
	assert.equal(sibling.cursorColumn, 6);
	model.redo();
	assert.equal(origin.cursorColumn, 3); assert.equal(sibling.cursorColumn, 7);
	assert.equal(origin.scrollRow, 7); assert.equal(origin.scrollLeft, 13);
	assert.equal(sibling.scrollRow, 70); assert.equal(sibling.scrollLeft, 41.5);
});

test('typing coalesces within a Source view but changing the origin separates shared-model undo elements', t => {
	const model = new EditorTextModel(resource, 'lua', 'root');
	const first = createCodeEditorViewState(), second = createCodeEditorViewState();
	first.cursorColumn = 4;
	const firstBinding = new CodeEditorViewBinding(model, first), secondBinding = new CodeEditorViewBinding(model, second);
	t.after(() => { firstBinding.dispose(); secondBinding.dispose(); model.dispose(); });
	const firstBefore = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 4, selectionAnchor: null }, first.editSource);
	const firstMiddle = codeEditorEditState.of({ ...firstBefore.value, cursorColumn: 5 }, first.editSource);
	const firstAfter = codeEditorEditState.of({ ...firstBefore.value, cursorColumn: 6 }, first.editSource);
	model.prepareUndo('typing', true, 1, firstBefore);
	model.applyUndoableReplace(4, 0, 'A');
	model.commitEdit(firstMiddle, { kind: 'insert', text: 'A' });
	model.prepareUndo('typing', true, 2, firstMiddle);
	model.applyUndoableReplace(5, 0, 'B');
	model.commitEdit(firstAfter, { kind: 'insert', text: 'B' });
	const secondBefore = codeEditorEditState.of({ ...firstBefore.value, cursorColumn: 0 }, second.editSource);
	const secondAfter = codeEditorEditState.of({ ...secondBefore.value, cursorColumn: 1 }, second.editSource);
	model.prepareUndo('typing', true, 3, secondBefore);
	model.applyUndoableReplace(0, 0, 'C');
	model.commitEdit(secondAfter, { kind: 'insert', text: 'C' });
	assert.equal(model.buffer.getText(), 'CrootAB');
	assert.equal(first.cursorColumn, 7); assert.equal(second.cursorColumn, 1);

	model.undo(second.editSource);
	assert.equal(model.buffer.getText(), 'rootAB');
	assert.equal(first.cursorColumn, 6); assert.equal(second.cursorColumn, 0);
	model.undo(first.editSource);
	assert.equal(model.buffer.getText(), 'root');
	assert.equal(first.cursorColumn, 4); assert.equal(second.cursorColumn, 0);
	assert.equal(model.canUndo, false);
	model.redo(first.editSource); model.redo(second.editSource);
	assert.equal(model.buffer.getText(), 'CrootAB');
	assert.equal(first.cursorColumn, 7); assert.equal(second.cursorColumn, 1);
});

test('retiring a Source view does not transfer its history snapshot authority to a later view of the same model', t => {
	const model = new EditorTextModel(resource, 'lua', 'abc');
	const retired = createCodeEditorViewState();
	const oldBinding = new CodeEditorViewBinding(model, retired);
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 1, selectionAnchor: null }, retired.editSource);
	const after = codeEditorEditState.of({ ...before.value, cursorColumn: 2 }, retired.editSource);
	model.pushEditOperations([{ offset: 1, deleteLength: 0, text: 'X' }], before, () => after);
	oldBinding.dispose();
	const replacement = createCodeEditorViewState();
	replacement.cursorColumn = 4; replacement.scrollRow = 71; replacement.scrollLeft = 8;
	const replacementBinding = new CodeEditorViewBinding(model, replacement);
	t.after(() => { replacementBinding.dispose(); model.dispose(); });
	model.undo();
	assert.equal(retired.cursorColumn, 2);
	assert.equal(replacement.cursorColumn, 3); assert.equal(replacement.scrollRow, 71); assert.equal(replacement.scrollLeft, 8);
	model.redo();
	assert.equal(replacement.cursorColumn, 4); assert.equal(replacement.scrollRow, 71); assert.equal(replacement.scrollLeft, 8);
});


test('Source Undo of a compound workspace edit restores only the invoking model view', t => {
	const { models, documents } = createTestCodeDocuments(t);
	const a = models.retain(resource, 'lua', 'abcdef');
	const b = models.retain({ ...resource, path: 'other.lua', location: { kind: 'workspace', path: 'other.lua' } }, 'lua', 'ghijkl');
	const aOrigin = createCodeEditorViewState(), aSibling = createCodeEditorViewState(), bOrigin = createCodeEditorViewState(), invoking = createCodeEditorViewState();
	const bindings = [new CodeEditorViewBinding(a, aOrigin), new CodeEditorViewBinding(a, aSibling),
		new CodeEditorViewBinding(b, bOrigin), new CodeEditorViewBinding(b, invoking)];
	t.after(() => {
		inputFocus.setTarget(null); activeCodeEditor.detach();
		for (const binding of bindings) binding.dispose();
		models.clear();
	});
	const aBefore = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 1, selectionAnchor: null }, aOrigin.editSource);
	const bBefore = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 3, selectionAnchor: { row: 0, column: 1 } }, bOrigin.editSource);
	models.history.applyEdits(new Map([
		[a, { version: a.version, edits: [{ offset: 1, deleteLength: 0, text: 'X' }], beforeEditState: aBefore,
			computeAfterEditState: () => codeEditorEditState.of({ ...aBefore.value, cursorColumn: 2 }, aOrigin.editSource) }],
		[b, { version: b.version, edits: [{ offset: 1, deleteLength: 0, text: 'Y' }], beforeEditState: bBefore,
			computeAfterEditState: () => codeEditorEditState.of({ ...bBefore.value, cursorColumn: 4, selectionAnchor: null }, bOrigin.editSource) }],
	]));
	aOrigin.cursorColumn = 7; aOrigin.scrollRow = 70; aOrigin.scrollLeft = 41.5;
	aSibling.cursorColumn = 5; bOrigin.cursorColumn = 7;
	activeCodeEditor.attach(b, invoking);
	configureFontVariant('tiny', documents.get(b));
	applyViewportSize({ width: 384, height: 288 }); refreshWorkbenchLayout();
	activeCodeEditor.focusTarget.focus();
	const seen: number[] = [];
	b.onDidChangeContent(() => seen.push(invoking.cursorColumn));
	undoSource();
	assert.equal(a.buffer.getText(), 'abcdef'); assert.equal(b.buffer.getText(), 'ghijkl');
	assert.equal(aOrigin.cursorColumn, 6); assert.equal(aSibling.cursorColumn, 4); assert.equal(bOrigin.cursorColumn, 6);
	assert.equal(invoking.cursorColumn, 3); assert.deepEqual(invoking.selectionAnchor, { row: 0, column: 1 });
	assert.equal(aOrigin.scrollRow, 70); assert.equal(aOrigin.scrollLeft, 41.5);
	redoSource();
	assert.equal(a.buffer.getText(), 'aXbcdef'); assert.equal(b.buffer.getText(), 'gYhijkl');
	assert.equal(aOrigin.cursorColumn, 7); assert.equal(aSibling.cursorColumn, 5); assert.equal(bOrigin.cursorColumn, 7);
	assert.equal(invoking.cursorColumn, 4); assert.equal(invoking.selectionAnchor, null);
	assert.equal(aOrigin.scrollRow, 70); assert.equal(aOrigin.scrollLeft, 41.5);
	assert.deepEqual(seen, [3, 4]);
});
