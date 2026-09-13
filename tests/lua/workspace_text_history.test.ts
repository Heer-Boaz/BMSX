import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorModelEdit, EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorEditStateType } from '../../ide/editor/model/edit_state';
import { EditorHistoryConflict, EditorWorkspaceEditConflict } from '../../ide/editor/model/undo_redo_service';
import { UNDO_HISTORY_LIMIT } from '../../ide/common/constants';

function fixture(t: TestContext) {
	const service = new EditorTextModelService();
	t.after(() => service.clear());
	const models = ['a.lua', 'b.lua', 'c.lua'].map((path, index) => service.retain({ domain: 0, path,
		source: { type: 'lua', resid: path } }, 'lua', String(index)));
	return { service, models, text: () => models.map(model => model.buffer.getText()),
		plan: (selected = models): Map<EditorTextModel, EditorModelEdit> => new Map(selected.map(model => [model,
			{ version: model.version, edits: [{ offset: 0, deleteLength: model.buffer.length, text: `[${model.buffer.getText()}]` }] }])),
	};
}

function append(model: EditorTextModel, text: string): void {
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text }]);
}

test('workspace edit, Undo and Redo publish complete buffers and one shared element from either source', t => {
	const f = fixture(t);
	const [a, b] = f.models;
	const before: string[][] = [], after: string[][] = [];
	for (const model of f.models) {
		model.onWillChangeContent(() => before.push(f.text()));
		model.onDidChangeContent(() => after.push(f.text()));
	}
	const state = new EditorEditStateType<string>();
	const plan = f.plan();
	plan.set(a, { ...plan.get(a)!, beforeEditState: state.of('before'), computeAfterEditState: () => {
		assert.deepEqual(f.text(), ['[0]', '[1]', '[2]']);
		return state.of('after');
	} });
	f.service.history.applyEdits(plan);
	assert.ok(f.models.every(model => model.dirty));
	assert.equal(a.undo()!.beforeEditState!.value, 'before');
	assert.ok(f.models.every(model => !model.dirty && !model.canUndo && model.canRedo));
	b.redo();
	assert.equal(a.undo()!.afterEditState!.value, 'after');
	assert.deepEqual(before.slice(0, 3), Array(3).fill(['0', '1', '2']));
	assert.deepEqual(before.slice(3, 6), Array(3).fill(['[0]', '[1]', '[2]']));
	assert.deepEqual(after.slice(0, 3), Array(3).fill(['[0]', '[1]', '[2]']));
	assert.deepEqual(after.slice(3, 6), Array(3).fill(['0', '1', '2']));
	assert.ok(f.models.every(model => model.version === 5));
});

test('intervening edits block the whole operation without changing history, versions or source notifications', t => {
	const f = fixture(t);
	const [a, b] = f.models;
	f.service.history.applyEdits(f.plan());
	append(b, 'later');
	let events = 0;
	for (const model of f.models) model.onWillChangeContent(() => events++);
	const versions = f.models.map(model => model.version);
	assert.throws(() => a.undo(), EditorHistoryConflict);
	assert.equal(events, 0);
	assert.deepEqual(f.models.map(model => model.version), versions);
	assert.deepEqual(f.text(), ['[0]', '[1]later', '[2]']);
	b.undo(); a.undo();
	assert.deepEqual(f.text(), ['0', '1', '2']);
	b.redo(); b.redo();
	assert.throws(() => a.undo(), EditorHistoryConflict);
	assert.deepEqual(f.text(), ['[0]', '[1]later', '[2]']);
});

test('a redo conflict requires the earlier redo in the other file, not a partial replay', t => {
	const f = fixture(t);
	const [a, b] = f.models;
	append(b, 'early');
	f.service.history.applyEdits(f.plan());
	a.undo(); b.undo();
	assert.throws(() => a.redo(), EditorHistoryConflict);
	assert.deepEqual(f.text(), ['0', '1', '2']);
	b.redo(); a.redo();
	assert.deepEqual(f.text(), ['[0]', '[1early]', '[2]']);
});

test('stale and read-only targets reject before any source or history changes', t => {
	const f = fixture(t);
	const [a, b] = f.models;
	const plan = f.plan();
	append(b, 'changed');
	assert.throws(() => f.service.history.applyEdits(plan), EditorWorkspaceEditConflict);
	assert.equal(a.version, 1); assert.equal(a.canUndo, false);
	const current = f.plan();
	b.refreshResource({ ...b.resource, source: { ...b.resource.source, generated: true } });
	assert.throws(() => f.service.history.applyEdits(current), EditorWorkspaceEditConflict);
	assert.deepEqual(f.text(), ['0', '1changed', '2']);
	b.refreshResource({ ...b.resource, source: { ...b.resource.source, generated: false } });
	f.service.history.applyEdits(current);
	b.refreshResource({ ...b.resource, source: { ...b.resource.source, generated: true } });
	assert.throws(() => a.undo(), EditorHistoryConflict);
	assert.deepEqual(f.text(), ['[0]', '[1changed]', '[2]']);
});

test('branching discards dependent redo tails but preserves earlier redo and unrelated source history', t => {
	const f = fixture(t);
	const [a, b, c] = f.models;
	append(b, 'early'); append(c, 'unrelated');
	f.service.history.applyEdits(f.plan([a, b]));
	append(b, 'late');
	b.undo(); a.undo(); b.undo();
	append(a, 'branch');
	assert.equal(a.canRedo, false); assert.equal(b.canRedo, true);
	b.redo();
	assert.equal(b.buffer.getText(), '1early');
	assert.equal(b.canRedo, false, 'the shared edit and its later dependent redo were discarded together');
	c.undo();
	assert.deepEqual(f.text(), ['0branch', '1early', '2']);
});

test('revert makes shared history a boundary in peers, without leaving holes or forgetting later local edits', t => {
	const f = fixture(t);
	const [a, b, c] = f.models;
	append(b, 'early');
	f.service.history.applyEdits(f.plan([a, b]));
	f.service.history.applyEdits(f.plan([b, c]));
	append(c, 'last');
	b.revert();
	assert.equal(a.canUndo, false);
	assert.equal(b.canUndo, false);
	assert.equal(c.canUndo, true);
	c.undo();
	assert.equal(c.canUndo, false);
	assert.deepEqual(f.text(), ['[0]', '1', '[2]']);
});

test('history limit releases a shared prefix once and retains valid later inverses in every model', t => {
	const f = fixture(t);
	const [a, b] = f.models;
	append(b, 'early');
	f.service.history.applyEdits(f.plan([a, b]));
	append(b, 'later');
	for (let index = 0; index < UNDO_HISTORY_LIMIT; index++) append(a, 'x');
	b.undo();
	assert.equal(b.canUndo, false);
	for (let index = 0; index < UNDO_HISTORY_LIMIT; index++) a.undo();
	assert.equal(a.canUndo, false);
	assert.deepEqual(f.text(), ['[0]', '[1early]', '2']);
	for (let index = 0; index < UNDO_HISTORY_LIMIT; index++) a.redo();
	assert.equal(a.buffer.getText(), '[0]' + 'x'.repeat(UNDO_HISTORY_LIMIT));
});

test('workspace edits are typing/save boundaries, and no-op participants acquire no history', t => {
	const f = fixture(t);
	const [a, b, c] = f.models;
	const type = new EditorEditStateType<number>();
	const typeX = (time: number) => {
		a.prepareUndo('typing', true, time, type.of(time));
		a.applyUndoableReplace(a.buffer.length, 0, 'x');
		a.commitEdit(type.of(time + 1), null);
	};
	typeX(0);
	const plan = f.plan([a, b]);
	plan.set(c, { version: c.version, edits: [] });
	f.service.history.applyEdits(plan);
	assert.equal(c.canUndo, false); assert.equal(c.version, 1);
	const saved = a.createSnapshot();
	typeX(1); a.completeSave(saved);
	assert.equal(a.dirty, true);
	a.undo(); assert.equal(a.dirty, false);
	b.undo(); assert.equal(a.buffer.getText(), '0x');
	a.undo(); assert.equal(a.buffer.getText(), '0');
	a.redo(); a.redo(); assert.equal(a.dirty, false);
});

// Save completion may run from a content listener, including for another
// participant whose content notification has not yet been delivered.
test('synchronous Save completion during content publication does not duplicate dirty notifications', t => {
	for (const grouped of [false, true]) {
		const f = fixture(t);
		const [a, b] = f.models;
		const dirty: string[] = [];
		for (const model of [a, b]) model.onDidChangeDirty(() => dirty.push(`${model.resource.path}:${model.dirty}`));
		a.onDidChangeContent(() => {
			a.completeSave(a.createSnapshot());
			if (grouped) b.completeSave(b.createSnapshot());
		});
		if (grouped) f.service.history.applyEdits(f.plan([a, b]));
		else append(a, 'x');
		const expected = grouped ? ['a.lua:false', 'b.lua:false'] : ['a.lua:false'];
		assert.deepEqual(dirty, expected);
		dirty.length = 0;
		a.undo();
		assert.deepEqual(dirty, expected);
		dirty.length = 0;
		a.redo();
		assert.deepEqual(dirty, expected);
	}
});
