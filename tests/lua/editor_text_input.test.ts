import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyInputEvent, KeyModifier, type TextInputHost } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { inputFocus } from '../../ide/input/focus';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { applyInlineFieldEditing, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { CodeEditorTextInput } from '../../ide/workbench/contrib/code_editor/native_text_input';
import { CodeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';

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
	const model = new EditorTextModel({ domain: 0, path: 'native.lua', source: { type: 'lua', resid: 'native' } }, 'lua', source);
	const view = createCodeEditorViewState(), inputs = new CodeEditorInputManager();
	inputs.register({ id: 'code:0\0native.lua', title: 'native.lua', model, view, runtimeErrorOverlay: null, executionStopRow: null });
	activeCodeEditor.attach(model, view); configureFontVariant(new VirtualHeadlessClock(), 'tiny', 'lua');
	const target = new CodeEditorTextInput();
	t.after(() => { inputs.clear(); activeCodeEditor.detach(); model.dispose(); clearBackgroundTasks(); });
	const from = source.indexOf('old'); target.setSelection(from, from + 3);
	const context = target.readText();
	assert.equal(context.offset, source.indexOf('local'));
	assert.equal(context.text.slice(context.selectionStart, context.selectionEnd), 'old');
	assert.equal(context.text.includes('header'), false); assert.equal(context.text.includes('return'), false);
	let writes = 0; model.onDidChangeContent(() => writes++);
	assert.equal(target.replaceText(from, from + 3, 'née😀'), true);
	assert.equal(writes, 1); assert.equal(model.buffer.getText(), source.replace('old', 'née😀'));
	model.undo(); assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	model.redo(); assert.equal(model.buffer.getText(), source.replace('old', 'née😀'));
});

test('native source selection notifies its actual cursor owner only on change', t => {
	const model = new EditorTextModel({ domain: 0, path: 'cursor.lua', source: { type: 'lua', resid: 'cursor' } }, 'lua', 'abc');
	activeCodeEditor.attach(model, createCodeEditorViewState()); configureFontVariant(new VirtualHeadlessClock(), 'tiny', 'lua');
	let moves = 0; const unbind = activeCodeEditor.onDidMoveCursor(() => moves++);
	t.after(() => { unbind(); activeCodeEditor.detach(); model.dispose(); clearBackgroundTasks(); });
	const target = new CodeEditorTextInput(); target.setSelection(1, 2); target.setSelection(1, 2);
	assert.equal(moves, 1); target.setSelection(2, 2); assert.equal(moves, 2);
	assert.equal(model.canUndo, false);
});
