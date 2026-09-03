import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeEditorViewSnapshot } from '../../ide/common/models';
import type { RuntimeResource } from '../../ide/common/resource';
import { editorDiagnosticsState } from '../../ide/editor/contrib/diagnostics/state';
import {
	EditorTextModel,
	type EditorTextModelContentChangeEvent,
} from '../../ide/editor/model/text_model';
import {
	EditorTextModelService,
	editorTextModelService,
} from '../../ide/editor/model/model_service';
import {
	ActiveCodeEditorState,
	activeCodeEditor,
	createCodeEditorViewState,
	type CodeEditorViewState,
} from '../../ide/editor/ui/code_editor_state';
import { collectDiagnosticsBatch } from '../../ide/workbench/contrib/code_editor/diagnostics/controller';
import { CodeEditorInputManager, codeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';
import { EditorTabGroupModel, editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { startSearchJob } from '../../ide/workbench/contrib/code_editor/find/search';
import { editorSearchState } from '../../ide/workbench/contrib/code_editor/find/widget_state';
import type { HostClock } from '../../hosts/common/clock';
import { backspace } from '../../ide/editor/editing/text_editing_and_selection';
import { restoreCodeEditorViewSnapshot, undo as undoActiveEdit } from '../../ide/editor/editing/undo_controller';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';

const editorTestClock: HostClock = {
	now: () => 0,
	dateNow: () => 0,
	scheduleOnce: () => ({
		cancel: () => {},
		isActive: () => false,
	}),
};

function luaResource(path: string): RuntimeResource {
	return {
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

function viewSnapshot(view: CodeEditorViewState): CodeEditorViewSnapshot {
	return {
		cursorRow: view.cursorRow,
		cursorColumn: view.cursorColumn,
		scrollRow: view.scrollRow,
		scrollColumn: view.scrollColumn,
		selectionAnchor: view.selectionAnchor,
	};
}

function codeContext(model: EditorTextModel, view: CodeEditorViewState): CodeTabContext {
	return {
		id: `code:${model.resource.domain}\0${model.resource.path}`,
		title: model.resource.path,
		model,
		view,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
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
	assert.equal(undone!.beforeViewState, null);
	const redone = model.redo();
	assert.equal(model.buffer.getText(), 'omega gamma!');
	assert.equal(redone!.afterViewState, null);

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

test('tab closure leaves the separately retained code input and resource model intact', () => {
	const resource = luaResource('retained.lua');
	const models = new EditorTextModelService();
	const inputs = new CodeEditorInputManager();
	const model = models.retain(resource, 'lua', 'return true');
	const context = codeContext(model, createCodeEditorViewState());
	inputs.register(context);
	const group = new EditorTabGroupModel();
	const tab = new CodeEditorInput(context);
	group.initialize(tab);
	assert.equal(tab.isDirty(), false);
	model.pushEditOperations([{ offset: 11, deleteLength: 0, text: '\n' }]);
	assert.equal(tab.isDirty(), true);
	group.removeAt(0);

	assert.equal(group.tabs.length, 0);
	assert.equal(group.activeTab, null);
	assert.strictEqual(inputs.get(context.id), context);
	assert.strictEqual(models.get(resource), model);
	assert.strictEqual(models.retain(resource, 'lua', 'discarded reload'), model);
	assert.equal(model.buffer.getText(), 'return true\n');
	models.clear();
});

test('attaching a retained view validates its positions against the current model', () => {
	const model = new EditorTextModel(luaResource('reattach.lua'), 'lua', 'longIdentifier');
	const view = createCodeEditorViewState();
	view.cursorColumn = model.buffer.length;
	view.selectionAnchor = { row: 0, column: model.buffer.length };
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'id' }]);

	const editor = new ActiveCodeEditorState();
	editor.attach(model, view);

	assert.equal(view.cursorColumn, 2);
	assert.deepEqual(view.selectionAnchor, { row: 0, column: 2 });
});

test('restoring a view does not lend mutable selection state from undo history', () => {
	const model = new EditorTextModel(luaResource('selection-history.lua'), 'lua', 'root');
	const view = createCodeEditorViewState();
	activeCodeEditor.attach(model, view);
	configureFontVariant(editorTestClock, DEFAULT_FONT_VARIANT, 'lua');
	const snapshot: CodeEditorViewSnapshot = {
		cursorRow: 0,
		cursorColumn: 2,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: { row: 0, column: 1 },
	};

	restoreCodeEditorViewSnapshot(snapshot, { preserveScroll: true });
	view.selectionAnchor!.column = 0;

	assert.equal(snapshot.selectionAnchor.column, 1);
});

test('backspace over a selection commits one model-owned undo element', () => {
	const model = new EditorTextModel(luaResource('selection-backspace.lua'), 'lua', 'root');
	const view = createCodeEditorViewState();
	view.cursorColumn = 4;
	view.selectionAnchor = { row: 0, column: 0 };
	activeCodeEditor.attach(model, view);
	configureFontVariant(editorTestClock, DEFAULT_FONT_VARIANT, 'lua');

	backspace();
	assert.equal(model.buffer.getText(), '');
	assert.equal(model.version, 2);

	undoActiveEdit();
	assert.equal(model.buffer.getText(), 'root');
	assert.equal(view.cursorColumn, 4);
	assert.deepEqual(view.selectionAnchor, { row: 0, column: 0 });
});

test('a local search job cannot continue against another model with the same version', (t) => {
	const first = new EditorTextModel(luaResource('first.lua'), 'lua', 'needle');
	const second = new EditorTextModel(luaResource('second.lua'), 'lua', 'needle');
	activeCodeEditor.attach(first, createCodeEditorViewState());
	editorSearchState.query = 'needle';
	editorSearchState.matches = [];
	startSearchJob();
	activeCodeEditor.attach(second, createCodeEditorViewState());
	t.after(() => {
		clearBackgroundTasks();
		editorSearchState.query = '';
		editorSearchState.matches = [];
		editorSearchState.job = null;
	});

	runBackgroundTasks({ now: () => 0 } as HostClock);

	assert.equal(editorSearchState.job, null);
	assert.deepEqual(editorSearchState.matches, []);
});

test('diagnostics select a retained dirty input while a non-code input is active', (t) => {
	editorTabGroup.clear();
	codeEditorInputManager.clear();
	editorTextModelService.clear();
	editorDiagnosticsState.dirtyDiagnosticContexts.clear();
	const resource = luaResource('background.lua');
	const model = editorTextModelService.retain(resource, 'lua', 'return true');
	model.pushEditOperations([{ offset: 11, deleteLength: 0, text: '!' }]);
	const context = codeContext(model, createCodeEditorViewState());
	const resourceTab = new ResourceViewerInput({
			resource: {
				domain: 0,
				path: 'image.png',
				source: {
					resid: 'image',
					type: 'image',
					source_path: 'image.png',
					generated: false,
				},
			},
			lines: [],
			error: '',
			title: 'image.png',
			scroll: 0,
	});
	assert.equal(resourceTab.isDirty(), false);
	codeEditorInputManager.register(context);
	editorTabGroup.initialize(resourceTab);
	editorDiagnosticsState.dirtyDiagnosticContexts.add(context.id);
	t.after(() => {
		editorTabGroup.clear();
		codeEditorInputManager.clear();
		editorTextModelService.clear();
		editorDiagnosticsState.dirtyDiagnosticContexts.clear();
	});

	assert.deepEqual(collectDiagnosticsBatch(), [context.id]);
});
