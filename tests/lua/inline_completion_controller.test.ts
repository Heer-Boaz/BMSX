import { createTestCodeControl } from '../helpers/code_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { codeEditorEditState } from '../../ide/editor/ui/code_editor_state';
import { undo as undoSource, redo as redoSource } from '../../ide/editor/editing/undo_controller';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorTextInput } from '../../ide/editor/input/native_text';
import { EditorCompletionController } from '../../ide/workbench/contrib/code_editor/suggest/completion_controller';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, source: string, columnOffset = source.length) {
	const record = createScenarioTestSourceRecord('inline.lua', 1, source);
	const sources = createScenarioTestSourceState([record]);
	const { documents, clock } = createTestCodeDocuments(t, editorTextModelService);
	const model = editorTextModelService.retain(sources.luaResources[0], 'lua', source);
	const input = new CodeEditorInput(model), view = input.context.view, position = { row: 0, column: 0 };
	model.buffer.positionAt(columnOffset, position); view.cursorRow = position.row; view.cursorColumn = position.column;
	const code = createTestCodeControl(t, model, documents, clock, view);
	code.focusTarget.focus();
	const controller = new EditorCompletionController(code, sources, null, null, null), native = new CodeEditorTextInput(code);
	const unbindBeforeContent = model.onWillChangeContent(() => {
		code.clearInlineEdit(); code.clearVisualCursor();
	});
	const unbindContent = model.onDidChangeContent(event => {
		controller.updateAfterEdit(event.editContext);
	});
	clock.advance(1000);
	t.after(() => {
		unbindBeforeContent(); unbindContent();
		controller.dispose(); inputFocus.setTarget(null); input.dispose(); code.detach();
		resetSemanticProjects(editorTextModelService); editorTextModelService.clear();
	});
	const type = (text: string) => {
		const at = model.buffer.offsetAt(view.cursorRow, view.cursorColumn);
		clock.advance(10);
		assert.equal(native.replaceText(at, at, text), true);
	};
	const settle = () => { clock.advance(200); controller.processPending(0.2); };
	return { code, model, view, controller, type, settle, documents, clock, sources };
}

test('real native typing publishes one widget-owned inline edit; reading it does not read candidates or source', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	const edit = f.code.inlineEdit, version = edit.version;
	assert.deepEqual(edit, { version, active: true, row: 0, startColumn: 5, endColumn: 5, text: 'n', preserveCase: false });
	assert.equal(f.model.buffer.getText(), 'retur');
	const item = f.controller.session!.filteredItems[f.controller.session!.selectionIndex], insertText = item.insertText;
	let candidateReads = 0;
	Object.defineProperty(item, 'insertText', { configurable: true, get() { candidateReads++; return insertText; } });
	t.after(() => Object.defineProperty(item, 'insertText', { configurable: true, writable: true, value: insertText }));
	const read = f.model.buffer.getLineContent.bind(f.model.buffer);
	const sourceReads = t.mock.method(f.model.buffer, 'getLineContent', read);
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.code.inlineEdit, edit);
	assert.equal(edit.version, version);
	assert.equal(candidateReads, 0); assert.equal(sourceReads.mock.callCount(), 0);
	f.controller.closeSession(); assert.equal(edit.active, false); assert.equal(edit.version, version + 1);
});

test('a mid-identifier suffix retains the actual Tab replacement and one source Undo', t => {
	const before = 'local sprite_direction = 1\nsprite_directi_tail';
	const f = fixture(t, before, before.indexOf('_tail'));
	f.type('o'); f.settle();
	const edit = f.code.inlineEdit;
	assert.deepEqual(edit, { version: edit.version, active: true, row: 1, startColumn: 'sprite_directio'.length,
		endColumn: 'sprite_directio_tail'.length, text: 'n', preserveCase: false });
	const typed = f.model.buffer.getText(), tab = new KeyInputEvent('Tab', KeyModifier.none);
	const beforeMutation: boolean[] = [];
	const unbind = f.model.onWillChangeContent(() => {
		beforeMutation.push(f.code.inlineEdit.active);
		assert.equal(f.controller.session, null, 'acceptance retires the admitted session before source mutation');
	});
	assert.equal(f.controller.handleKeybindings(tab), true); assert.equal(tab.consumed, true);
	assert.deepEqual(beforeMutation, [false]); unbind();
	assert.equal(f.model.buffer.getLineContent(1), 'sprite_direction');
	assert.equal(f.code.inlineEdit.active, false);
	undoSource(f.code); assert.equal(f.model.buffer.getText(), typed);
	assert.equal(f.view.cursorRow, 1); assert.equal(f.view.cursorColumn, 'sprite_directio'.length);
	assert.equal(f.view.selectionAnchor, null, 'Undo restores the real pre-Tab caret, not the replacement range');
});

test('explicit completion preserves an actual reversed user selection in Undo and its final caret in Redo', t => {
	const source = 'retur_tail()', f = fixture(t, source, 2);
	setSingleCursorSelectionAnchor(f.view, 0, 8);
	const candidates = f.controller.listCompletionCandidates()!, item = candidates.filteredItems.find(item => item.label === 'return')!;
	assert.ok(item);
	f.controller.applyCompletionItem(candidates.context, item);
	assert.equal(f.model.buffer.getText(), 'return()'); assert.equal(f.view.cursorColumn, 6); assert.equal(f.view.selectionAnchor, null);
	undoSource(f.code);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.view.cursorColumn, 2);
	assert.deepEqual(f.view.selectionAnchor, { row: 0, column: 8 }, 'the original reverse orientation is history state');
	redoSource(f.code);
	assert.equal(f.model.buffer.getText(), 'return()'); assert.equal(f.view.cursorColumn, 6); assert.equal(f.view.selectionAnchor, null);
});

// These two admitted-item cases exercise the real command/TextEditing/model/history
// contract, not provider discovery or live native-method availability.
for (const [label, kind, insertion, expectedCaret] of [
	['draw', 'native_method', 'draw()', 5], ['array[]', 'local', 'array[]', 6],
] as const) {
	test(`${kind} ${label} completion publishes its final internal caret to content observers and Redo`, t => {
		const source = 'dra_tail', f = fixture(t, source, 3), context = f.controller.listCompletionCandidates()!.context;
		const observed: Array<{ kind: string; row: number; column: number; anchor: { row: number; column: number } | null }> = [];
		const unbind = f.model.onDidChangeContent(event => observed.push({ kind: event.kind, row: f.view.cursorRow,
			column: f.view.cursorColumn, anchor: f.view.selectionAnchor === null ? null : { ...f.view.selectionAnchor } }));
		t.after(unbind);
		f.controller.applyCompletionItem(context, { label, kind, insertText: label, sortKey: `${kind}:${label}`, detail: '' });
		assert.equal(f.model.buffer.getText(), insertion); assert.equal(f.view.cursorColumn, expectedCaret);
		undoSource(f.code); redoSource(f.code);
		assert.deepEqual(observed, [
			{ kind: 'edit', row: 0, column: expectedCaret, anchor: null },
			{ kind: 'undo', row: 0, column: 3, anchor: null },
			{ kind: 'redo', row: 0, column: expectedCaret, anchor: null },
		]);
		assert.equal(f.model.buffer.getText(), insertion); assert.equal(f.view.cursorColumn, expectedCaret); assert.equal(f.view.selectionAnchor, null);
	});
}

test('an actual empty require-path candidate inserts at a zero-width range with one complete edit and exact history', t => {
	const source = "local m = require('')", column = source.indexOf("')"), f = fixture(t, source, column);
	editorTextModelService.retain({ sourceFilePath: 'module/real.lua', location: { kind: 'workspace' as const, path: 'module/real.lua' }, domain: 0, path: 'module/real.lua',
		source: { type: 'lua', resid: 'real-module', source_path: 'module/real.lua' } }, 'lua', 'return {}');
	registerLuaSourceRecord(f.sources.cartridgeSlots[0]!.luaSources, createScenarioTestSourceRecord('module/real.lua', 1, 'return {}'));
	const candidates = f.controller.listCompletionCandidates()!, item = candidates.filteredItems.find(item => item.insertText === 'module/real')!;
	assert.equal(candidates.context.kind, 'module'); assert.equal(candidates.context.replaceFromColumn, column);
	assert.equal(candidates.context.replaceToColumn, column); assert.ok(item);
	let changes = 0;
	const unbind = f.model.onDidChangeContent(() => {
		changes++;
		if (changes === 1) assert.equal(f.view.cursorColumn, column + item.insertText.length);
	});
	t.after(unbind);
	f.controller.applyCompletionItem(candidates.context, item);
	assert.equal(f.model.buffer.getText(), "local m = require('module/real')"); assert.equal(changes, 1);
	undoSource(f.code); assert.equal(f.model.buffer.getText(), source); assert.equal(f.view.cursorColumn, column); assert.equal(f.view.selectionAnchor, null);
	redoSource(f.code); assert.equal(f.model.buffer.getText(), "local m = require('module/real')");
	assert.equal(f.view.cursorColumn, column + item.insertText.length); assert.equal(f.view.selectionAnchor, null); assert.equal(changes, 3);
});

test('Undo updates completion only after the retained code view publishes its restored source cursor', t => {
	const source = 'local other = 1', f = fixture(t, source, 0);
	const before = codeEditorEditState.of({ cursorRow: 0, cursorColumn: 0, selectionAnchor: null }, f.view.editSource);
	const after = codeEditorEditState.of({ ...before.value, cursorRow: 1, cursorColumn: 4 }, f.view.editSource);
	f.model.pushEditOperations([{ offset: source.length, deleteLength: 0, text: '\nretu' }], before, () => after);
	assert.equal(f.view.cursorRow, 1); assert.equal(f.view.cursorColumn, 4);
	f.type('r'); f.settle();
	assert.equal(f.code.inlineEdit.active, true); assert.equal(f.code.inlineEdit.row, 1);
	undoSource(f.code);
	assert.equal(f.view.cursorRow, 1); assert.equal(f.view.cursorColumn, 4);
	assert.equal(f.code.inlineEdit.active, true); assert.equal(f.code.inlineEdit.startColumn, 4);
	undoSource(f.code);
	assert.equal(f.view.cursorRow, 0); assert.equal(f.view.cursorColumn, 0);
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
	assert.equal(f.model.buffer.getText(), source);
});

test('empty-suffix tail removal needs an explicit popup, never invisible automatic Tab admission', t => {
	const before = 'local sprite = 1\nsprit_tail', f = fixture(t, before, before.indexOf('_tail'));
	f.type('e'); f.settle();
	assert.equal(f.code.inlineEdit.active, false); assert.equal(f.controller.session, null);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.equal(f.model.buffer.getLineContent(1), 'sprite_tail');
	f.controller.handleKeybindings(new KeyInputEvent('Space', KeyModifier.ctrl));
	assert.equal(f.controller.session!.filteredItems[f.controller.session!.selectionIndex].insertText, 'sprite');
	assert.equal(f.code.inlineEdit.active, false);
	assert.equal(f.controller.handleKeybindings(new KeyInputEvent('Tab', KeyModifier.none)), true);
	assert.equal(f.model.buffer.getLineContent(1), 'sprite');
});

test('automatic substring-only matches never capture Tab; explicit completion still exposes them', t => {
	const f = fixture(t, 'local prefix_zzmatch_tail = 1\nzzmatc'); f.type('h'); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.ok(f.controller.listCompletionCandidates()!.filteredItems.some(item => item.label === 'prefix_zzmatch_tail'));
	f.controller.handleKeybindings(new KeyInputEvent('Space', KeyModifier.ctrl));
	assert.ok(f.controller.session!.filteredItems.some(item => item.label === 'prefix_zzmatch_tail'));
	assert.equal(f.code.inlineEdit.active, false, 'manual candidates belong to the explicit popup');
});

test('automatic candidate navigation republishes the widget edit without writing source', t => {
	const f = fixture(t, 'local alpha_one = 1\nlocal alpha_two = 2\nalp'); f.type('h'); f.settle();
	assert.equal(f.code.inlineEdit.text, 'a_one');
	const source = f.model.buffer.getText(), version = f.model.version;
	f.controller.handleKeybindings(new KeyInputEvent('Tab', KeyModifier.shift));
	assert.equal(f.code.inlineEdit.text, 'a_two');
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
});

test('input retirement clears the published completion before another source attaches', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	assert.equal(f.code.inlineEdit.active, true);
	f.controller.clearInput();
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
	const other = editorTextModelService.retain({ sourceFilePath: 'other.lua', location: { kind: 'workspace' as const, path: 'other.lua' }, domain: 0, path: 'other.lua', source: { type: 'lua', resid: 'other' } }, 'lua', 'local other = 1');
	const otherInput = new CodeEditorInput(other); t.after(() => otherInput.dispose());
	f.code.attach(other, otherInput.context.view, f.documents.get(other)); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.equal(other.buffer.getText(), 'local other = 1');
});

test('retiring an admitted but unpublished typing request prevents it from appearing on the next update', t => {
	const f = fixture(t, 'retu'); f.type('r');
	assert.equal(f.controller.session, null);
	f.controller.clearInput(); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
	assert.equal(f.model.buffer.getText(), 'retur');
});

test('source blur retires automatic completion before the incoming control gains focus', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	assert.equal(f.code.inlineEdit.active, true);
	const destination = inputFocus.createTarget(), source = f.model.buffer.getText(), version = f.model.version;
	const unbind = destination.onDidFocus(() => {
		assert.equal(f.controller.session, null);
		assert.equal(f.code.inlineEdit.active, false);
	});
	t.after(unbind);
	destination.focus();
	f.code.focusTarget.focus(); f.settle();
	assert.equal(f.controller.session, null, 'returning source focus is not a fresh typing trigger');
	assert.equal(f.code.inlineEdit.active, false);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
});

test('source blur cancels an unpublished request even when source focus returns before the next frame', t => {
	const f = fixture(t, 'ret'); f.type('u');
	assert.equal(f.controller.session, null);
	inputFocus.createTarget().focus(); f.code.focusTarget.focus(); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
	assert.equal(f.model.buffer.getText(), 'retu');
	f.type('r'); f.settle();
	assert.equal(f.code.inlineEdit.active, true, 'fresh typing after focus return still admits an automatic suggestion');
	assert.equal(f.code.inlineEdit.text, 'n');
});

test('explicit completion popup survives source focus transfer without becoming an automatic ghost', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	assert.equal(f.controller.handleKeybindings(new KeyInputEvent('Space', KeyModifier.ctrl)), true);
	const session = f.controller.session!;
	assert.equal(session.trigger, 'manual'); assert.equal(f.code.inlineEdit.active, false);
	inputFocus.createTarget().focus(); f.settle();
	assert.equal(f.controller.session, session); assert.equal(f.code.inlineEdit.active, false);
	f.code.focusTarget.focus();
	assert.equal(f.controller.handleKeybindings(new KeyInputEvent('Tab', KeyModifier.none)), true);
	assert.equal(f.model.buffer.getText(), 'return'); assert.equal(f.controller.session, null);
});

test('input retirement owns signature-hint lifetime, while closing suggestions alone preserves it', t => {
	const f = fixture(t, 'local function paint(value)\nend\npaint'); f.type('(');
	assert.notEqual(f.controller.hint, null);
	const hint = f.controller.hint;
	f.controller.closeSession(); assert.equal(f.controller.hint, hint);
	f.controller.clearInput(); assert.equal(f.controller.hint, null); assert.equal(f.controller.popupBounds, null);
	assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
});

for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
	test(`${code} dismisses automatic projection before ordinary navigation reads geometry`, t => {
		const f = fixture(t, 'retu'); f.type('r'); f.settle();
		assert.equal(f.code.inlineEdit.active, true);
		const key = new KeyInputEvent(code, KeyModifier.none);
		assert.equal(f.controller.handleKeybindings(key), false); assert.equal(key.consumed, false);
		assert.equal(f.controller.session, null); assert.equal(f.code.inlineEdit.active, false);
		assert.equal(f.view.cursorColumn, 5, 'the ordinary navigation handler still owns cursor movement');
	});
}

test('module completion preserves authored case and exact path replacement range', t => {
	const source = "local m = require('art/P_tail')", f = fixture(t, source, source.indexOf('_tail'));
	editorTextModelService.retain({ sourceFilePath: 'art/Picture.lua', location: { kind: 'workspace' as const, path: 'art/Picture.lua' }, domain: 0, path: 'art/Picture.lua', source: { type: 'lua', resid: 'picture', source_path: 'art/Picture.lua' } }, 'lua', 'return {}');
	registerLuaSourceRecord(f.sources.cartridgeSlots[0]!.luaSources, createScenarioTestSourceRecord('art/Picture.lua', 1, 'return {}'));
	f.type('i'); f.settle();
	const edit = f.code.inlineEdit;
	assert.equal(edit.active, true); assert.equal(edit.preserveCase, true); assert.equal(edit.text, 'cture');
	assert.equal(edit.startColumn, "local m = require('art/Pi".length);
	assert.equal(edit.endColumn, "local m = require('art/Pi_tail".length);
	assert.equal(f.model.buffer.getText(), "local m = require('art/Pi_tail')");
});

test('widget publication is stable across font replacement but retires before source identity changes', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	const edit = f.code.inlineEdit, version = edit.version;
	f.code.setFont(new EditorFont('msx'));
	assert.equal(f.code.inlineEdit, edit); assert.equal(edit.active, true); assert.equal(edit.version, version);
	assert.equal(f.code.setInlineEdit(edit.row, edit.startColumn, edit.endColumn, edit.text, edit.preserveCase), false);
	assert.equal(edit.version, version, 'republishing identical intent cannot dirty layout');
	const other = editorTextModelService.retain({ sourceFilePath: 'other.lua', location: { kind: 'workspace' as const, path: 'other.lua' }, domain: 0, path: 'other.lua', source: { type: 'lua', resid: 'other' } }, 'lua', 'local other = 1');
	const otherInput = new CodeEditorInput(other), document = f.documents.get(other);
	t.after(() => otherInput.dispose());
	assert.equal(edit.active, true, 'constructing an unrelated input and document does not retire this control');
	const attach = f.code.layout.attach.bind(f.code.layout);
	t.mock.method(f.code.layout, 'attach', next => {
		assert.equal(edit.active, false, 'old presentation retires before the new projection attaches');
		assert.ok(f.code.model === other, 'the new projection belongs to the admitted model');
		attach(next);
	});
	f.code.attach(other, otherInput.context.view, document);
	assert.equal(edit.active, false); assert.equal(edit.version, version + 1);
	assert.equal(f.code.setInlineEdit(0, 0, 5, 'example'), true);
	f.code.detach(); assert.equal(edit.active, false); assert.equal(f.code.model, null);
});
