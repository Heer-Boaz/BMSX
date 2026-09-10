import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorEditStateType } from '../../ide/editor/model/edit_state';
import { CodeEditorViewBinding } from '../../ide/editor/ui/code_editor_view_binding';
import { codeEditorEditState, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';

const resource = { domain: 0 as const, path: 'positions.lua', source: { resid: 'positions.lua', type: 'lua' as const } };

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

test('explicit code edit state owns the result and Undo; external changes subsequently track that position', t => {
	const model = new EditorTextModel(resource, 'lua', 'abc');
	const view = createCodeEditorViewState();
	const binding = new CodeEditorViewBinding(model, view);
	t.after(() => { binding.dispose(); model.dispose(); });
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 1, selectionAnchor: null, scrollRow: 0, scrollColumn: 0 });
	const after = codeEditorEditState.of({ ...before.value, cursorRow: 1, cursorColumn: 3 });
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '\n' }], before, () => after);
	assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 3);
	model.undo(); assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 1);
	model.redo(); assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 3);
	model.pushEditOperations([{ offset: 0, deleteLength: 1, text: '' }]);
	assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 3);
});

test('history capture treats wrapped scroll rows as view coordinates, not text positions', t => {
	const model = new EditorTextModel(resource, 'lua', 'local very_long_line = 123456789');
	const view = createCodeEditorViewState();
	view.cursorColumn = 6; view.scrollRow = 5;
	const input = new CodeEditorInput({ id: 'code:0\0positions.lua', title: 'positions', model, view, runtimeErrorOverlay: null, executionStopRow: null });
	const selection = new CodeEditorNavigationSelection(input);
	t.after(() => { selection.dispose(); input.dispose(); model.dispose(); });
	assert.equal(selection.cursor, 6); assert.equal(selection.scrollRow, 5);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉\n' }]);
	assert.equal(selection.cursor, 12); assert.equal(selection.scrollRow, 5);
});
