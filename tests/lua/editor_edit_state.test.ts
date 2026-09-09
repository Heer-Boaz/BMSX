import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorEditStateType } from '../../ide/editor/model/edit_state';
import { EditorTextModel, type EditorTextModelContentChangeEvent } from '../../ide/editor/model/text_model';

const resource = { domain: 0 as const, path: 'history.lua', source: { type: 'lua' as const, resid: 'history' } };
const selection = new EditorEditStateType<{ readonly position: number }>();

test('one document record publishes the computed result, Undo origin and Redo result after the actual text change', () => {
	const model = new EditorTextModel(resource, 'lua', 'abc');
	const before = selection.of({ position: 2 });
	const after = selection.of({ position: 4 });
	const seen: [string, EditorTextModelContentChangeEvent][] = [];
	model.onDidChangeContent(event => seen.push([model.buffer.getText(), event]));
	let computations = 0;
	model.pushEditOperations([{ offset: 1, deleteLength: 1, text: 'XYZ' }], before, changes => {
		computations += 1;
		assert.equal(model.buffer.getText(), 'aXYZc');
		assert.deepEqual(changes, [{ offset: 1, deletedLength: 1, insertedLength: 3 }]);
		return after;
	});
	assert.equal(model.undo()!.beforeEditState, before);
	assert.equal(model.redo()!.afterEditState, after);
	assert.equal(computations, 1, 'history retains state values, not a callback that re-runs on another source');
	assert.deepEqual(seen.map(([source, event]) => [source, event.kind, event.version, event.editState]), [
		['aXYZc', 'edit', 2, after], ['abc', 'undo', 3, before], ['aXYZc', 'redo', 4, after],
	]);
	model.dispose();
});

test('coalesced input retains its first origin and final result, and never merges another editor state type', () => {
	const model = new EditorTextModel(resource, 'lua', '');
	const other = new EditorEditStateType<string>();
	for (let index = 0; index < 2; index += 1) {
		model.prepareUndo('typing', true, index, selection.of({ position: index }));
		model.applyUndoableReplace(index, 0, 'x');
		model.commitEdit(selection.of({ position: index + 1 }), null);
	}
	model.prepareUndo('typing', true, 2, other.of('before'));
	model.applyUndoableReplace(2, 0, 'y');
	model.commitEdit(other.of('after'), null);
	const first = model.undo()!;
	assert.equal(model.buffer.getText(), 'xx');
	assert.ok(first.beforeEditState!.is(other));
	assert.equal(first.beforeEditState.value, 'before');
	const second = model.undo()!;
	assert.equal(model.buffer.getText(), '');
	assert.ok(second.beforeEditState!.is(selection) && second.afterEditState!.is(selection));
	assert.equal(second.beforeEditState.value.position, 0);
	assert.equal(second.afterEditState.value.position, 2);
	model.dispose();
});

test('ordinary edits, empty commands, branching and revert do not invent or replay edit-associated state', () => {
	const model = new EditorTextModel(resource, 'lua', 'original');
	const events: EditorTextModelContentChangeEvent[] = [];
	model.onDidChangeContent(event => events.push(event));
	model.pushEditOperations([], selection.of({ position: 0 }), () => { throw new Error('empty command must not compute state'); });
	assert.equal(model.canUndo, false);
	assert.equal(events.length, 0);
	model.pushEditOperations([{ offset: 8, deleteLength: 0, text: 'x' }], selection.of({ position: 8 }), () => selection.of({ position: 9 }));
	model.undo();
	model.pushEditOperations([{ offset: 8, deleteLength: 0, text: 'y' }]);
	assert.equal(model.canRedo, false);
	assert.equal(events.at(-1)!.editState, null);
	model.revert();
	assert.equal(events.at(-1)!.editState, null);
	assert.equal(model.canUndo, false);
	assert.equal(model.buffer.getText(), 'original');
	model.dispose();
});
