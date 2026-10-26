import { createTestCodeControl } from '../helpers/code_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import type { CodeEditorControl } from '../../ide/editor/ui/code_editor_control';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import type { RuntimeSourceState } from '../../ide/runtime/sources';

import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EditorEditStateType } from '../../ide/editor/model/edit_state';
import type { RuntimeResource } from '../../ide/common/resource';
import {
	EditorTextModel,
	type EditorTextModelContentChangeEvent,
} from '../../ide/editor/model/text_model';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { codeEditorEditState, applyCodeEditorSelectionSnapshot, createCodeEditorViewState, type CodeEditorViewState, type CodeEditorSelectionSnapshot } from '../../ide/editor/ui/code_editor_state';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { backspace, deleteForward, deleteWordBackward, deleteWordForward, indentSelectionOrLine, insertLineBreak, insertText, pasteText, unindentSelectionOrLine } from '../../ide/editor/editing/text_editing_and_selection';
import { getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { undo as undoActiveEdit, redo as redoActiveEdit } from '../../ide/editor/editing/undo_controller';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';

function luaResource(path: string): RuntimeResource {
	return { location: { kind: 'workspace' as const, path },
		domain: 0,
		path,
		source: {
			resid: path,
			type: 'lua',
			source_path: path,
			generated: false,
		},
	};
}

test('model service publishes one addition per lifetime and removal after releasing the resource', () => {
	const service = new EditorTextModelService();
	const added: EditorTextModel[] = [];
	const removed: EditorTextModel[] = [];
	const unsubscribeAdded = service.onDidAddModel(model => {
		assert.equal(service.get(model.resource), model);
		added.push(model);
	});
	const unsubscribeRemoved = service.onDidRemoveModel(model => {
		assert.equal(service.get(model.resource), undefined);
		removed.push(model);
	});
	const resource = luaResource('model.lua');
	const model = service.retain(resource, 'lua', 'return true');
	assert.equal(service.retain(resource, 'lua', 'return false'), model);
	assert.deepEqual(added, [model]);
	service.clear();
	assert.deepEqual(removed, [model]);
	unsubscribeAdded(); unsubscribeRemoved();
	service.retain(resource, 'lua', 'return false');
	service.clear();
	assert.deepEqual(added, [model]); assert.deepEqual(removed, [model]);
});

test('initial dirty source has a distinct saved baseline and unique edit history states', () => {
	const service = new EditorTextModelService();
	const resource = luaResource('recovered.lua');
	const model = service.retain(resource, 'lua', 'draft', 'saved');
	assert.equal(model.buffer.getText(), 'draft');
	assert.equal(model.lastSavedSource, 'saved');
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, false);
	model.pushEditOperations([{ offset: 5, deleteLength: 0, text: ' edited' }]);
	model.undo();
	assert.equal(model.buffer.getText(), 'draft');
	assert.equal(model.dirty, true);
	model.redo();
	const snapshot = model.createSnapshot();
	model.completeSave(snapshot);
	assert.equal(model.dirty, false);
	model.undo();
	assert.equal(model.dirty, true);
	assert.equal(model.lastSavedSource, 'draft edited');
	assert.equal(service.retain(resource, 'lua', 'different effective', 'different saved'), model);
	assert.equal(model.buffer.getText(), 'draft');
	assert.equal(model.lastSavedSource, 'draft edited');
	model.revert();
	assert.equal(model.buffer.getText(), 'draft edited');
	assert.equal(model.dirty, false);
	service.clear();
});

function viewSnapshot(view: CodeEditorViewState) {
	return codeEditorEditState.of({
		cursorRow: view.cursorRow,
		cursorColumn: view.cursorColumn,
		selectionAnchor: view.selectionAnchor,
	}, view.editSource);
}

test('one text model publishes atomic edits and lifecycle events to two independent views', () => {
	const model = new EditorTextModel(luaResource('shared.lua'), 'lua', 'alpha beta');
	const firstView = createCodeEditorViewState();
	const secondView = createCodeEditorViewState();
	firstView.cursorColumn = 10;
	secondView.cursorColumn = 2;
	secondView.scrollRow = 4;

	const firstEvents: string[] = [];
	const secondEvents: string[] = [];
	let firstDirtyEvents = 0;
	let secondDirtyEvents = 0;
	let firstSaveEvents = 0;
	let secondSaveEvents = 0;
	let firstRevertEvents = 0;
	let secondRevertEvents = 0;
	const recordContent = (target: string[]) => (event: EditorTextModelContentChangeEvent): void => {
		target.push(`${event.kind}:${event.version}`);
	};
	model.onDidChangeContent(recordContent(firstEvents));
	model.onDidChangeContent(recordContent(secondEvents));
	model.onDidChangeDirty(() => firstDirtyEvents += 1);
	model.onDidChangeDirty(() => secondDirtyEvents += 1);
	model.onDidSave(() => firstSaveEvents += 1);
	model.onDidSave(() => secondSaveEvents += 1);
	model.onDidRevert(() => firstRevertEvents += 1);
	model.onDidRevert(() => secondRevertEvents += 1);

	const beforeTyping = viewSnapshot(firstView);
	model.prepareUndo('typing', true, 1, beforeTyping);
	model.applyUndoableReplace(10, 0, '!');
	firstView.cursorColumn = 11;
	model.commitEdit(viewSnapshot(firstView), { kind: 'insert', text: '!' });
	assert.equal(model.buffer.getText(), 'alpha beta!');
	assert.equal(model.dirty, true);

	model.pushEditOperations([
		{ offset: 0, deleteLength: 5, text: 'omega' },
		{ offset: 6, deleteLength: 4, text: 'gamma' },
	]);
	assert.equal(model.buffer.getText(), 'omega gamma!');

	const undone = model.undo();
	assert.equal(model.buffer.getText(), 'alpha beta!');
	assert.equal(undone!.beforeEditState, null);
	const redone = model.redo();
	assert.equal(model.buffer.getText(), 'omega gamma!');
	assert.equal(redone!.afterEditState, null);

	const saved = model.createSnapshot();
	model.completeSave(saved);
	assert.equal(model.dirty, false);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '?' }]);
	assert.equal(model.dirty, true);
	model.revert();
	assert.equal(model.buffer.getText(), saved.source);
	assert.equal(model.dirty, false);

	assert.deepEqual(firstEvents, [
		'edit:2',
		'edit:3',
		'undo:4',
		'redo:5',
		'edit:6',
		'revert:7',
	]);
	assert.deepEqual(secondEvents, firstEvents);
	assert.equal(firstDirtyEvents, 4);
	assert.equal(secondDirtyEvents, firstDirtyEvents);
	assert.equal(firstSaveEvents, 1);
	assert.equal(secondSaveEvents, firstSaveEvents);
	assert.equal(firstRevertEvents, 1);
	assert.equal(secondRevertEvents, firstRevertEvents);
	assert.equal(firstView.cursorColumn, 11);
	assert.equal(secondView.cursorColumn, 2);
	assert.equal(secondView.scrollRow, 4);
});

test('dirty identity survives an undo followed by a same-depth history branch', () => {
	const model = new EditorTextModel(luaResource('branch.lua'), 'lua', 'root');
	model.pushEditOperations([{ offset: 4, deleteLength: 0, text: '-saved' }]);
	model.completeSave(model.createSnapshot());
	assert.equal(model.dirty, false);

	model.undo();
	assert.equal(model.buffer.getText(), 'root');
	assert.equal(model.dirty, true);
	model.pushEditOperations([{ offset: 4, deleteLength: 0, text: '-branch' }]);

	assert.equal(model.buffer.getText(), 'root-branch');
	assert.equal(model.dirty, true);
});

test('an edit command with no operations preserves redo history and model version', () => {
	const model = new EditorTextModel(luaResource('noop.lua'), 'lua', 'root');
	model.pushEditOperations([{ offset: 4, deleteLength: 0, text: '-edit' }]);
	model.undo();
	const version = model.version;
	const view = createCodeEditorViewState();
	model.prepareUndo('no-op', false, 10, viewSnapshot(view));
	assert.equal(model.commitEdit(viewSnapshot(view), null), false);
	assert.equal(model.version, version);

	model.redo();
	assert.equal(model.buffer.getText(), 'root-edit');
});

test('save start is an undo boundary while completion preserves later typing coalescence', () => {
	const model = new EditorTextModel(luaResource('save-race.lua'), 'lua', 'zero');
	const view = createCodeEditorViewState();
	model.prepareUndo('typing', true, 1, viewSnapshot(view));
	model.applyUndoableReplace(4, 0, '-one');
	view.cursorColumn = 8;
	model.commitEdit(viewSnapshot(view), { kind: 'insert', text: '-one' });
	const saving = model.createSnapshot();
	model.prepareUndo('typing', true, 2, viewSnapshot(view));
	model.applyUndoableReplace(8, 0, '-two');
	view.cursorColumn = 12;
	model.commitEdit(viewSnapshot(view), { kind: 'insert', text: '-two' });

	model.completeSave(saving);
	model.prepareUndo('typing', true, 3, viewSnapshot(view));
	model.applyUndoableReplace(12, 0, '-three');
	view.cursorColumn = 18;
	model.commitEdit(viewSnapshot(view), { kind: 'insert', text: '-three' });

	assert.equal(model.lastSavedSource, 'zero-one');
	assert.equal(model.buffer.getText(), 'zero-one-two-three');
	assert.equal(model.dirty, true);
	model.undo();
	assert.equal(model.buffer.getText(), 'zero-one');
	assert.equal(model.dirty, false);
});

test('two groups own independent Source inputs over one working copy and closing either retires only its binding', t => {
	const resource = luaResource('retained.lua'), models = new EditorTextModelService();
	const model = models.retain(resource, 'lua', 'abcdef');
	const first = new CodeEditorInput(model), second = new CodeEditorInput(model);
	const firstGroup = new EditorTabGroupModel(), secondGroup = new EditorTabGroupModel();
	firstGroup.initialize(first); secondGroup.initialize(second);
	t.after(() => { firstGroup.clear(); secondGroup.clear(); models.clear(); });
	const firstView = first.context.view, secondView = second.context.view;
	firstView.cursorColumn = 3; firstView.scrollRow = 2.5;
	secondView.cursorColumn = 5; secondView.scrollRow = 7.25;
	assert.equal(first.id, second.id, 'resource matching remains local to each group');
	assert.notEqual(first, second); assert.notEqual(first.context, second.context); assert.notEqual(firstView, secondView);
	assert.notEqual(firstView.editSource, secondView.editSource);
	assert.equal(first.workingCopy, second.workingCopy);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'X' }]);
	assert.equal(firstView.cursorColumn, 4); assert.equal(secondView.cursorColumn, 6);
	assert.equal(first.isDirty(), true); assert.equal(second.isDirty(), true);
	firstGroup.removeAt(0);
	assert.equal(firstGroup.activeTab, null); assert.equal(secondGroup.activeTab, second);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'Y' }]);
	assert.equal(firstView.cursorColumn, 4, 'closed inputs no longer track model changes');
	assert.equal(secondView.cursorColumn, 7); assert.equal(secondView.scrollRow, 7.25);
	assert.equal(firstView.scrollRow, 2.5);
	assert.equal(models.get(resource), model); assert.equal(model.buffer.getText(), 'YXabcdef'); assert.equal(model.dirty, true);
	const reopened = new CodeEditorInput(model);
	firstGroup.add(reopened); firstGroup.activate(reopened);
	assert.notEqual(reopened.context.view, firstView); assert.notEqual(reopened.context.view.editSource, firstView.editSource);
	assert.equal(reopened.context.view.cursorColumn, 0);
	secondGroup.clear();
	model.undo();
	assert.equal(model.buffer.getText(), 'Xabcdef'); assert.equal(model.dirty, true);
	assert.equal(secondView.cursorColumn, 7, 'the other group also releases its own binding at close');
	assert.equal(reopened.workingCopy, model);
});

test('retained code inputs track programmatic history independently of the active unrelated widget', t => {
	const model = new EditorTextModel(luaResource('hidden-code.lua'), 'lua', 'abc');
	const input = new CodeEditorInput(model), view = input.context.view;
	const other = new EditorTextModel(luaResource('active-code.lua'), 'lua', 'other');
	const otherInput = new CodeEditorInput(other), otherView = otherInput.context.view;
	const { documents, clock } = createTestCodeDocuments(t);
	const code = createTestCodeControl(t, other, documents, clock, otherView);
	t.after(() => { code.detach(); input.dispose(); otherInput.dispose(); model.dispose(); other.dispose(); });
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 3, selectionAnchor: { row: 0, column: 1 } }, view.editSource);
	const after = codeEditorEditState.of({ ...before.value, cursorColumn: 4 }, view.editSource);
	model.pushEditOperations([{ offset: 3, deleteLength: 0, text: 'x' }], before, () => after);
	assert.equal(view.cursorColumn, 4);
	assert.equal(view.selectionAnchor, view.selectionAnchorScratch, 'state application reuses the input-owned cursor anchor');
	assert.notEqual(view.selectionAnchor, before.value.selectionAnchor);
	model.undo();
	assert.equal(view.cursorColumn, 3);
	view.selectionAnchor.column = 2;
	assert.equal(before.value.selectionAnchor.column, 1, 'view changes cannot alter history values');
	model.redo();
	assert.equal(view.cursorColumn, 3, 'marker affinity excludes text reinserted at the selected range edge');
	assert.equal(view.selectionAnchor.column, 2, 'programmatic Redo maps the current selection instead of restoring a saved one');
	assert.equal(code.model, other);
	assert.equal(otherView.cursorColumn, 0, 'history does not mutate the active unrelated code widget');
});

test('same-group matching retires only its offered Source candidate and foreign state kinds do not become selections', t => {
	const model = new EditorTextModel(luaResource('subscription.lua'), 'lua', 'abc');
	const retained = new CodeEditorInput(model), candidate = new CodeEditorInput(model), sibling = new CodeEditorInput(model);
	const group = new EditorTabGroupModel(), siblingGroup = new EditorTabGroupModel();
	group.initialize(retained); siblingGroup.initialize(sibling);
	t.after(() => { group.clear(); siblingGroup.clear(); model.dispose(); });
	const view = retained.context.view, rejectedView = candidate.context.view;
	view.cursorColumn = 3; rejectedView.cursorColumn = 2;
	assert.equal(group.add(candidate), retained);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'X' }]);
	assert.equal(view.cursorColumn, 4); assert.equal(rejectedView.cursorColumn, 2);
	const before = viewSnapshot(view), foreign = new EditorEditStateType<CodeEditorSelectionSnapshot>();
	const foreignSelection = { ...before.value, cursorColumn: 0 };
	model.pushEditOperations([{ offset: 4, deleteLength: 0, text: 'y' }], foreign.of(foreignSelection, view.editSource),
		() => foreign.of(foreignSelection, view.editSource));
	assert.equal(view.cursorColumn, 4, 'a matching receiver does not make a foreign payload kind into a Source selection');
	group.clear();
	model.undo(view.editSource); model.undo(view.editSource);
	assert.equal(view.cursorColumn, 4, 'closed inputs no longer consume model events');
	assert.equal(siblingGroup.activeTab, sibling); assert.equal(sibling.workingCopy, model);
});

test('the model service enumerates dirty working copies independently of editor inputs', () => {
	const models = new EditorTextModelService();
	const first = models.retain(luaResource('first-dirty.lua'), 'lua', 'first');
	const second = models.retain(luaResource('second-dirty.lua'), 'lua', 'second');
	first.pushEditOperations([{ offset: first.buffer.length, deleteLength: 0, text: '-edit' }]);
	second.pushEditOperations([{ offset: second.buffer.length, deleteLength: 0, text: '-edit' }]);

	assert.deepEqual(models.dirtyWorkingCopies, [first, second]);
	first.completeSave(first.createSnapshot());
	assert.deepEqual(models.dirtyWorkingCopies, [second]);
	models.clear();
});

test('attaching a retained view validates its positions against the current model', t => {
	const { documents, clock } = createTestCodeDocuments(t);
	const model = new EditorTextModel(luaResource('reattach.lua'), 'lua', 'longIdentifier');
	const view = createCodeEditorViewState();
	view.cursorColumn = model.buffer.length;
	view.selectionAnchor = { row: 0, column: model.buffer.length };
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'id' }]);

	const code = createTestCodeControl(t, model, documents, clock, view);

	assert.equal(code.model, model);
	assert.equal(view.cursorColumn, 2);
	assert.deepEqual(view.selectionAnchor, { row: 0, column: 2 });
});

test('applying a Source history selection does not lend its mutable anchor to the view', () => {
	const view = createCodeEditorViewState();
	const snapshot: CodeEditorSelectionSnapshot = {
		cursorRow: 0, cursorColumn: 2, selectionAnchor: { row: 0, column: 1 },
	};
	applyCodeEditorSelectionSnapshot(view, snapshot);
	view.selectionAnchor.column = 0;
	assert.equal(snapshot.selectionAnchor.column, 1);
});

test('backspace over a selection commits one model-owned undo element', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain(luaResource('selection-backspace.lua'), 'lua', 'root');
	const input = new CodeEditorInput(model), view = input.context.view;
	view.cursorColumn = 4;
	view.selectionAnchor = { row: 0, column: 0 };
	t.after(() => { code.detach(); input.dispose(); });
	const code = createTestCodeControl(t, model, documents, clock, view, new EditorFont(DEFAULT_FONT_VARIANT));

	backspace(code);
	assert.equal(model.buffer.getText(), '');
	assert.equal(model.version, 2);

	undoActiveEdit(code);
	assert.equal(model.buffer.getText(), 'root');
	assert.equal(view.cursorColumn, 4);
	assert.deepEqual(view.selectionAnchor, { row: 0, column: 0 });
});

test('backspace after Shift+End on an empty line publishes a collapsed caret when that line is removed', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain(luaResource('empty-selection.lua'), 'lua', 'head\n');
	const input = new CodeEditorInput(model), view = input.context.view;
	view.cursorRow = 1;
	setSingleCursorSelectionAnchor(view, 1, 0);
	const code = createTestCodeControl(t, model, documents, clock, view, new EditorFont(DEFAULT_FONT_VARIANT));
	t.after(() => { input.dispose(); code.detach(); });

	backspace(code);
	insertText(code, '!');
	assert.equal(model.buffer.getText(), 'head!');
	assert.equal(getSingleCursorSelectionRange(view), null);
	undoActiveEdit(code);
	assert.equal(model.buffer.getText(), 'head');
	assert.equal(getSingleCursorSelectionRange(view), null);
	undoActiveEdit(code);
	assert.equal(model.buffer.getText(), 'head\n');
	assert.equal(view.cursorRow, 1);
	assert.equal(getSingleCursorSelectionRange(view), null);
	redoActiveEdit(code); redoActiveEdit(code);
	assert.equal(model.buffer.getText(), 'head!');
	assert.equal(getSingleCursorSelectionRange(view), null);
});

test('ordinary text edits publish and retain a collapsed result selection, including an initially empty anchor', t => {
	const cases = [
		{ run: (code: CodeEditorControl) => insertText(code, 'x'), source: 'abc', column: 1, result: 'axbc' },
		{ run: insertLineBreak, source: 'abc', column: 1, result: 'a\nbc' },
		{ run: (code: CodeEditorControl) => pasteText(code, 'x\ny'), source: 'abc', column: 1, result: 'ax\nybc' },
		{ run: backspace, source: 'abc', column: 1, result: 'bc' },
		{ run: deleteForward, source: 'a\nb', column: 1, result: 'ab' },
		{ run: deleteWordBackward, source: 'one two', column: 4, result: 'two' },
		{ run: deleteWordForward, source: 'one two', column: 0, result: 'two' },
		{ run: indentSelectionOrLine, source: 'abc', column: 1, result: '\tabc' },
		{ run: unindentSelectionOrLine, source: '\tabc', column: 2, result: 'abc' },
	];
	for (const entry of cases) {
		const { models, documents, clock } = createTestCodeDocuments(t);
		const model = models.retain(luaResource('edit-selection.lua'), 'lua', entry.source);
		const input = new CodeEditorInput(model), view = input.context.view;
		view.cursorColumn = entry.column;
		setSingleCursorSelectionAnchor(view, 0, entry.column);
		const code = createTestCodeControl(t, model, documents, clock, view, new EditorFont(DEFAULT_FONT_VARIANT));
		t.after(() => { input.dispose(); code.detach(); });
		let events = 0;
		model.onDidChangeContent(() => {
			events += 1;
			assert.equal(getSingleCursorSelectionRange(view), null);
			model.buffer.offsetAt(view.cursorRow, view.cursorColumn);
		});
		entry.run(code);
		assert.equal(model.buffer.getText(), entry.result);
		const cursor = { row: view.cursorRow, column: view.cursorColumn };
		undoActiveEdit(code);
		assert.equal(model.buffer.getText(), entry.source);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, entry.column);
		redoActiveEdit(code);
		assert.equal(model.buffer.getText(), entry.result);
		assert.equal(view.cursorRow, cursor.row); assert.equal(view.cursorColumn, cursor.column);
		assert.equal(events, 3);
	}
});

test('a local search job cannot continue against another model with the same version', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const first = models.retain(luaResource('first.lua'), 'lua', 'needle');
	const second = models.retain(luaResource('second.lua'), 'lua', 'needle');
	const code = createTestCodeControl(t, first, documents, clock);
	const search = new EditorSearchController(code, {} as RuntimeSourceState);
	t.after(() => { search.dispose(); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true);
	search.openSearch(false);
	code.attach(second, createCodeEditorViewState(), documents.get(second));
	runBackgroundTasks(clock);
	assert.equal(search.state.job, null);
	assert.deepEqual(search.state.matches, []);
});

test('canonical source clamps survive document shrink without a font or layout', () => {
	const model = new EditorTextModel(luaResource('source-boundaries.lua'), 'lua', 'long first line\nsecond line\nlast');
	const retained = { row: 1, column: 3 }, offset = model.buffer.length;
	assert.equal(model.clampPosition(retained), retained, 'valid source positions retain identity');
	assert.equal(model.clampRow(-1), 0); assert.equal(model.clampRow(100), 2);
	assert.equal(model.clampColumn(100, 100), 4);
	assert.equal(model.clampOffset(-1), 0); assert.equal(model.clampOffset(offset + 1), offset);
	let applied: import('../../ide/editor/model/text_model').EditorTextModelAppliedChanges;
	model.onDidApplyChanges(event => { applied = event; });
	model.pushEditOperations([{ offset: 0, deleteLength: offset, text: 'x\nyz' }]);
	assert.equal(model.clampRow(100), 1);
	assert.equal(model.clampColumn(100, 100), 2);
	assert.deepEqual(model.clampPosition(retained), { row: 1, column: 2 });
	assert.deepEqual(model.clampPosition({ row: -1, column: -1 }), { row: 0, column: 0 });
	assert.equal(model.clampOffset(offset), 4);
	const valid = { row: 0, column: 1 };
	assert.equal(model.clampPosition(valid), valid);
	assert.equal(applied!.startRow, 0);
	assert.equal(applied!.endRow, 1);
	assert.equal(applied!.lineCount, 2, 'post-apply extent describes the producer\'s final canonical text');
	model.dispose();
});
