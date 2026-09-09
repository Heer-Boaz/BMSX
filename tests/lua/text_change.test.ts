import { codeEditorEditState } from '../../ide/editor/ui/code_editor_state';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CodeEditorViewSnapshot } from '../../ide/common/models';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel, type EditorTextModelContentChangeEvent } from '../../ide/editor/model/text_model';
import { mapTrackedTextRange, textChangesEndOffset, type EditorTextChange } from '../../ide/editor/text/text_change';

const resource: RuntimeResource = {
	domain: 0, path: 'tracked.lua',
	source: { resid: 'tracked.lua', type: 'lua', source_path: 'tracked.lua', generated: false },
};
const view: CodeEditorViewSnapshot = {
	cursorRow: 0, cursorColumn: 0, scrollRow: 0, scrollColumn: 0, selectionAnchor: null,
};

test('source ranges follow edits without growing at their edges or adopting replacement text', () => {
	const cases: readonly [EditorTextChange, number, number][] = [
		[{ offset: 0, deletedLength: 0, insertedLength: 2 }, 7, 12],
		[{ offset: 0, deletedLength: 3, insertedLength: 0 }, 2, 7],
		[{ offset: 5, deletedLength: 0, insertedLength: 2 }, 7, 12],
		[{ offset: 10, deletedLength: 0, insertedLength: 2 }, 5, 10],
		[{ offset: 12, deletedLength: 1, insertedLength: 0 }, 5, 10],
		[{ offset: 7, deletedLength: 1, insertedLength: 3 }, 5, 12],
		[{ offset: 7, deletedLength: 1, insertedLength: 0 }, 5, 9],
		[{ offset: 3, deletedLength: 3, insertedLength: 1 }, 4, 8],
		[{ offset: 8, deletedLength: 4, insertedLength: 1 }, 5, 9],
		[{ offset: 4, deletedLength: 3, insertedLength: 3 }, 5, 10],
		[{ offset: 5, deletedLength: 5, insertedLength: 7 }, 5, 5],
		[{ offset: 4, deletedLength: 7, insertedLength: 0 }, 4, 4],
	];
	for (const [change, start, end] of cases) {
		const range = { start: 5, end: 10 };
		mapTrackedTextRange(range, [change]);
		assert.deepEqual(range, { start, end }, JSON.stringify(change));
	}
	const removed = { start: 5, end: 10 };
	mapTrackedTextRange(removed, [
		{ offset: 5, deletedLength: 5, insertedLength: 0 },
		{ offset: 5, deletedLength: 0, insertedLength: 5 },
	]);
	assert.equal(removed.start, removed.end, 'Undo of a deletion is not a new user selection');
});

test('the text model emits applied-order changes for atomic edits, Undo and Redo', () => {
	const model = new EditorTextModel(resource, 'lua', 'aaa target zzz');
	const range = { start: 4, end: 10 };
	const events: EditorTextModelContentChangeEvent[] = [];
	model.onDidChangeContent(event => {
		mapTrackedTextRange(range, event.changes);
		events.push(event);
	});
	model.pushEditOperations([
		{ offset: 0, deleteLength: 1, text: 'prefix' },
		{ offset: 7, deleteLength: 1, text: 'XYZ' },
	]);
	assert.equal(events.length, 1);
	assert.deepEqual(events[0].changes, [
		{ offset: 7, deletedLength: 1, insertedLength: 3 },
		{ offset: 0, deletedLength: 1, insertedLength: 6 },
	]);
	assert.deepEqual(range, { start: 9, end: 17 });
	assert.equal(textChangesEndOffset(events[0].changes), 15);
	assert.equal(model.buffer.getTextRange(range.start, range.end), 'tarXYZet');
	model.undo();
	assert.deepEqual(events[1].changes, [
		{ offset: 0, deletedLength: 6, insertedLength: 1 },
		{ offset: 7, deletedLength: 3, insertedLength: 1 },
	]);
	assert.deepEqual(range, { start: 4, end: 10 });
	assert.equal(textChangesEndOffset(events[1].changes), 8);
	assert.equal(model.buffer.getTextRange(range.start, range.end), 'target');
	model.redo();
	assert.deepEqual(events[2].changes, events[0].changes);
	assert.deepEqual(range, { start: 9, end: 17 });

	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: '' }]);
	assert.equal(range.start, range.end);
	model.undo();
	assert.equal(range.start, range.end, 'history does not recreate a removed selection');
	assert.deepEqual(events[0].changes[1], { offset: 0, deletedLength: 1, insertedLength: 6 }, 'retained events are independent of mutable history');
});

test('affected text extent belongs to the final buffer, including deletions and overlapping applied edits', () => {
	const cases: readonly [readonly EditorTextChange[], number][] = [
		[[{ offset: 3, deletedLength: 5, insertedLength: 0 }], 3],
		[[{ offset: 3, deletedLength: 0, insertedLength: 5 }, { offset: 0, deletedLength: 10, insertedLength: 1 }], 1],
		[[{ offset: 3, deletedLength: 0, insertedLength: 5 }, { offset: 10, deletedLength: 2, insertedLength: 0 }], 10],
		[[{ offset: 10, deletedLength: 1, insertedLength: 2 }, { offset: 5, deletedLength: 0, insertedLength: 4 }], 16],
	];
	for (const [changes, end] of cases) assert.equal(textChangesEndOffset(changes), end);
});

test('coalesced typing emits only the new replacements, while history emits the complete inverse', () => {
	const model = new EditorTextModel(resource, 'lua', 'abc');
	const events: EditorTextModelContentChangeEvent[] = [];
	model.onDidChangeContent(event => events.push(event));
	model.prepareUndo('typing', true, 1, codeEditorEditState.of(view));
	model.applyUndoableReplace(3, 0, 'X');
	model.commitEdit(codeEditorEditState.of(view), null);
	model.prepareUndo('typing', true, 2, codeEditorEditState.of(view));
	model.applyUndoableReplace(4, 0, 'Y');
	model.commitEdit(codeEditorEditState.of(view), null);
	assert.deepEqual(events[0].changes, [{ offset: 3, deletedLength: 0, insertedLength: 1 }]);
	assert.deepEqual(events[1].changes, [{ offset: 4, deletedLength: 0, insertedLength: 1 }]);
	model.undo();
	assert.equal(model.buffer.getText(), 'abc');
	assert.deepEqual(events[2].changes, [
		{ offset: 4, deletedLength: 1, insertedLength: 0 },
		{ offset: 3, deletedLength: 1, insertedLength: 0 },
	]);
	model.redo();
	assert.equal(model.buffer.getText(), 'abcXY');
	assert.deepEqual(events[3].changes, [...events[0].changes, ...events[1].changes]);
});

test('revert and restored workspace bytes publish a whole-document replacement', () => {
	const model = new EditorTextModel(resource, 'lua', 'aaa target zzz');
	const range = { start: 4, end: 10 };
	const events: EditorTextModelContentChangeEvent[] = [];
	model.onDidChangeContent(event => {
		mapTrackedTextRange(range, event.changes);
		events.push(event);
	});
	model.restoreDirtySource('different');
	assert.deepEqual(events[0].changes, [{ offset: 0, deletedLength: 14, insertedLength: 9 }]);
	assert.equal(range.start, range.end);
	range.start = 0;
	range.end = 9;
	model.revert();
	assert.deepEqual(events[1].changes, [{ offset: 0, deletedLength: 9, insertedLength: 14 }]);
	assert.equal(range.start, range.end);
});
