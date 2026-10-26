import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyInputEvent, KeyModifier, type TextInputHost } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { inputFocus } from '../../ide/input/focus';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { applyInlineFieldEditing, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { CodeEditorTextInput } from '../../ide/editor/input/native_text';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { expandTabs } from '../../ide/common/text';
import { setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { replaceSelectionWith, replaceTextRange } from '../../ide/editor/editing/text_editing_and_selection';
import { prepareUndo, undo as undoSource, redo as redoSource } from '../../ide/editor/editing/undo_controller';
import { resolveViewportCapacity } from '../../ide/editor/ui/view/caret/view';

function sourceRangeFixture(t: TestContext, source: string) {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'range.lua' }, domain: 0, path: 'range.lua', source: { type: 'lua', resid: 'range' } }, 'lua', source);
	const input = new CodeEditorInput(model), view = input.context.view;
	const code = createTestCodeControl(t, model, documents, clock, view, undefined, { left: 0, top: 10, right: 78, bottom: 270 });
	code.focusTarget.focus();
	t.after(() => {
		input.dispose();
		clearBackgroundTasks();
	});
	return { code, model, view, layout: code.layout };
}

test('native source caret projects the canonical tab and wrapped position before paint independently of blink', t => {
	const { code, model, view, layout } = sourceRangeFixture(t, '\tfirst\n' + 'local value = 12345; '.repeat(80) + 'return 7');
	const target = new CodeEditorTextInput(code), visible = code.caret.cursorVisible;
	t.after(() => { code.caret.cursorVisible = visible; });
	target.setSelection(1, 1);
	const viewport = resolveViewportCapacity(code), entry = layout.getViewLine(0);
	const display = layout.columnToDisplay(entry.hi, 1);
	for (const blink of [false, true]) {
		code.caret.cursorVisible = blink;
		const caret = target.caretRect();
		assert.equal(caret.x, viewport.textLeft + entry.advancePrefix[display]);
		assert.equal(caret.y, viewport.codeTop); assert.equal(caret.height, code.lineHeight);
		assert.equal(caret.width, layout.cursorWidth(entry, display));
	}
	target.setSelection(model.buffer.length, model.buffer.length);
	const wrapped = { ...target.caretRect() }, revision = model.version;
	assert.ok(wrapped.width > 0 && wrapped.height > 0);
	assert.ok(wrapped.x >= viewport.textLeft && wrapped.x + wrapped.width <= viewport.contentRight);
	assert.ok(wrapped.y >= viewport.codeTop && wrapped.y + wrapped.height <= viewport.contentBottom);
	view.scrollRow = 0;
	assert.equal(target.caretRect().width, 0); assert.equal(target.caretRect().height, 0);
	assert.equal(model.version, revision); assert.equal(model.canUndo, false);
});

test('prepared explicit multiline UTF16 range edits publish their internal caret and invalidate the complete insertion', t => {
	const source = 'head\nAAAA\nBBBB\nCCCC\nfoot', { code, model, view, layout } = sourceRangeFixture(t, source);
	view.cursorRow = 0; view.cursorColumn = 1; setSingleCursorSelectionAnchor(view, 4, 2);
	resolveViewportCapacity(code);
	const oldVisualCount = layout.getVisualLineCount();
	const observed: Array<{ kind: string; row: number; column: number; anchor: { row: number; column: number } | null }> = [];
	const unbind = model.onDidChangeContent(event => observed.push({ kind: event.kind, row: view.cursorRow,
		column: view.cursorColumn, anchor: view.selectionAnchor === null ? null : { ...view.selectionAnchor } }));
	t.after(unbind);
	const insertion = `\t😀inside\n\tmiddle_${'abcd'.repeat(12)}\n\ttail_${'wxyz'.repeat(15)}`;
	const from = source.indexOf('AAAA'), to = source.indexOf('CCCC') + 'CCCC'.length;
	const expected = source.slice(0, from) + insertion + source.slice(to);
	prepareUndo(code, 'explicit-range', false); replaceTextRange(code, from, to, insertion, '\t😀'.length);
	assert.equal(model.buffer.getText(), expected); assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 3);
	assert.equal(view.selectionAnchor, null);
	resolveViewportCapacity(code);
	assert.ok(layout.getVisualLineCount() > oldVisualCount + 6, 'prewarmed later rows are replaced by their complete wrapped contents');
	const lines = expected.split('\n');
	for (let row = 0; row < lines.length; row++) {
		const line = layout.getViewLine(row), segments = layout.getVisualLines().filter(segment => segment.row === row);
		assert.equal(segments.map(segment => line.hi.text.slice(segment.startDisplay, segment.endDisplay)).join(''), expandTabs(lines[row]));
	}
	undoSource(code);
	assert.equal(model.buffer.getText(), source); assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 1);
	assert.deepEqual(view.selectionAnchor, { row: 4, column: 2 }); assert.equal(model.canUndo, false);
	redoSource(code);
	assert.equal(model.buffer.getText(), expected); assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 3);
	assert.equal(view.selectionAnchor, null);
	assert.deepEqual(observed, [
		{ kind: 'edit', row: 1, column: 3, anchor: null },
		{ kind: 'undo', row: 0, column: 1, anchor: { row: 4, column: 2 } },
		{ kind: 'redo', row: 1, column: 3, anchor: null },
	]);
});

test('selection replacement keeps its default end-of-insertion and deletion caret contracts', t => {
	const source = 'one\nold\nlast', { code, model, view } = sourceRangeFixture(t, source);
	view.cursorRow = 1; view.cursorColumn = 0; setSingleCursorSelectionAnchor(view, 1, 3);
	prepareUndo(code, 'replace-selection', false); replaceSelectionWith(code, '\t😀\nnext');
	assert.equal(model.buffer.getText(), 'one\n\t😀\nnext\nlast');
	assert.equal(view.cursorRow, 2); assert.equal(view.cursorColumn, 4); assert.equal(view.selectionAnchor, null);
	setSingleCursorSelectionAnchor(view, 1, 0); prepareUndo(code, 'delete-selection', false); replaceSelectionWith(code, '');
	assert.equal(model.buffer.getText(), 'one\n\nlast');
	assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 0); assert.equal(view.selectionAnchor, null);
	undoSource(code); assert.equal(model.buffer.getText(), 'one\n\t😀\nnext\nlast');
	undoSource(code); assert.equal(model.buffer.getText(), source);
});

test('the actual focused text field preserves virtual text, edits and submission before any poll', t => {
	const field = new TextField(), clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const submitted: string[] = [];
	field.focusTarget.bindKeyboard(event => {
		if (event.code === 'Enter' && event.down) { submitted.push(field.text); event.consumed = true; }
		else applyInlineFieldEditing(event, field);
	});
	const host: TextInputHost = {
		get textTarget() { return inputFocus.target?.textInput; },
		dispatchKey(event) { inputFocus.handleKeyboard(event); return event.consumed; },
		cancelPointerInput() {},
		cancelInput() { inputFocus.cancelInput(); },
		onDidChangeTarget: listener => inputFocus.onDidChangeTarget(listener),
	};
	input.setEditingInput(host); field.focusTarget.focus();
	t.after(() => { inputFocus.setTarget(null); input.dispose(); });
	for (const code of ['KeyA', 'ArrowLeft', 'KeyB', 'KeyB', 'Enter']) {
		input.setVirtualKeyboardKey(code, true); input.setVirtualKeyboardKey(code, false);
	}
	assert.equal(field.text, 'bba'); assert.deepEqual(submitted, ['bba']);
	assert.equal(input.getPlayerInput(1).pollFrame, 0);
	field.undo(); assert.equal(field.text, 'ba');
	field.redo(); assert.equal(field.text, 'bba');
	inputFocus.handleKeyboard(new KeyInputEvent('KeyA', KeyModifier.ctrl));
	assert.deepEqual(field.readText(), { text: 'bba', selectionStart: 0, selectionEnd: 3, offset: 0 });
});

test('native field constraints retain the accepted edit and its own cursor', () => {
	const field = new TextField(null, { allowSpace: false, singleLine: true, maxLength: 4,
		characterFilter: ch => ch >= '0' && ch <= '9' });
	setFieldText(field, '1234', true); field.setSelection(1, 1);
	assert.equal(field.replaceText(1, 1, '5'), false);
	assert.equal(field.text, '1234'); assert.equal(field.readText().selectionEnd, 1);
	assert.equal(field.canUndo, false);
	assert.equal(field.replaceText(1, 3, 'x7y'), false);
	assert.equal(field.text, '174'); assert.equal(field.readText().selectionEnd, 2);
	field.undo(); assert.equal(field.text, '1234'); assert.equal(field.readText().selectionEnd, 3);
	field.readOnly = true;
	assert.equal(field.replaceText(0, 4, '5'), false); assert.equal(field.text, '1234');
});

test('native source replacement uses bounded canonical context and one shared Undo operation', t => {
	const source = '-- header\r\nlocal label = "old"\r\nreturn label\r\n';
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'native.lua' }, domain: 0, path: 'native.lua', source: { type: 'lua', resid: 'native' } }, 'lua', source);
	const input = new CodeEditorInput(model), view = input.context.view;
	const code = createTestCodeControl(t, model, documents, clock, view);
	const target = new CodeEditorTextInput(code);
	t.after(() => { input.dispose(); code.detach(); clearBackgroundTasks(); });
	const from = source.indexOf('old'); target.setSelection(from, from + 3);
	const context = target.readText();
	assert.equal(context.offset, source.indexOf('local'));
	assert.equal(context.text.slice(context.selectionStart, context.selectionEnd), 'old');
	assert.equal(context.text.includes('header'), false); assert.equal(context.text.includes('return'), false);
	let writes = 0; model.onDidChangeContent(() => writes++);
	assert.equal(target.replaceText(from, from + 3, 'née😀'), true);
	assert.equal(writes, 1); assert.equal(model.buffer.getText(), source.replace('old', 'née😀'));
	undoSource(code); assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	redoSource(code); assert.equal(model.buffer.getText(), source.replace('old', 'née😀'));
});

test('native source selection notifies its actual cursor owner only on change', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'cursor.lua' }, domain: 0, path: 'cursor.lua', source: { type: 'lua', resid: 'cursor' } }, 'lua', 'abc');
	const input = new CodeEditorInput(model);
	const code = createTestCodeControl(t, model, documents, clock, input.context.view);
	let moves = 0; const unbind = code.onDidMoveCursor(() => moves++);
	t.after(() => { unbind(); code.detach(); input.dispose(); clearBackgroundTasks(); });
	const target = new CodeEditorTextInput(code); target.setSelection(1, 2); target.setSelection(1, 2);
	assert.equal(moves, 1); target.setSelection(2, 2); assert.equal(moves, 2);
	assert.equal(model.canUndo, false);
});
