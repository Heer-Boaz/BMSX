import assert from 'node:assert/strict';
import test from 'node:test';
import { InputFocusService, inputFocus } from '../../ide/input/focus';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, setFieldText, selectAll, backspace, setCursorFromOffset } from '../../ide/editor/ui/inline/text_field';
import { resolveEditorCommandKeybinding } from '../../ide/input/keyboard/command_keybindings';
import { KeyModifier } from '../../hosts/common/input/player';
import { Input } from '../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';

test('focus dispatch has one concrete keyboard owner and detaches before blur notification', () => {
	const focus = new InputFocusService();
	const first = focus.createTarget();
	const second = focus.createTarget();
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1).getPlayerInput(1);
	const calls: string[] = [];
	first.bindKeyboard(() => calls.push('first-input'));
	second.bindKeyboard(() => calls.push('second-input'));
	second.onDidFocus(() => {
		assert.equal(focus.target, second);
		calls.push('second-focus');
	});
	first.onDidBlur(() => {
		assert.equal(focus.target, null);
		assert.equal(first.hasFocus, false);
		calls.push('first-blur');
	});
	first.focus();
	focus.handleKeyboard(input);
	first.focus();
	second.focus();
	focus.handleKeyboard(input);
	first.release();
	assert.equal(focus.target, second, 'hiding an unfocused control does not steal focus');
	assert.deepEqual(calls, ['first-input', 'first-blur', 'second-focus', 'second-input']);
});

test('empty and disabled focused history cannot fall through to document commands', (t) => {
	t.after(() => inputFocus.setTarget(null));
	const document = inputFocus.createTarget();
	let documentUndos = 0;
	document.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndos += 1; } });
	const field = new TextField(document);
	field.focusTarget.focus();
	const binding = resolveEditorCommandKeybinding('KeyZ', KeyModifier.ctrl, { isEnabled: () => false });
	assert.equal(binding!.command, 'undo', 'an empty field still owns the keybinding');
	inputFocus.executeCommand(binding!.command);
	assert.equal(documentUndos, 0);
	field.focusTarget.registerCommand('undo', { isEnabled: () => false, run: () => assert.fail('disabled command executed') });
	inputFocus.executeCommand('undo');
	assert.equal(documentUndos, 0);
	field.focusTarget.release();
	inputFocus.executeCommand('undo');
	assert.equal(documentUndos, 1);
});

test('graph folding binds unmodified Space only to the concrete graph focus', (t) => {
	t.after(() => inputFocus.setTarget(null));
	const graph = inputFocus.createTarget();
	let enabled = true;
	let folds = 0;
	graph.registerCommand('behaviorLens.toggleBranch', {
		isEnabled: () => enabled,
		run: () => { folds += 1; },
	});
	const commands = { isEnabled: () => true };
	graph.focus();
	const binding = resolveEditorCommandKeybinding('Space', KeyModifier.none, commands)!;
	assert.equal(binding.command, 'behaviorLens.toggleBranch');
	assert.notEqual(binding.repeat, true, 'folding uses the existing just-pressed command path');
	inputFocus.executeCommand(binding.command);
	assert.equal(folds, 1);
	for (const modifier of [KeyModifier.ctrl, KeyModifier.meta, KeyModifier.shift, KeyModifier.alt]) {
		assert.equal(resolveEditorCommandKeybinding('Space', modifier, commands), null);
	}
	enabled = false;
	assert.equal(resolveEditorCommandKeybinding('Space', KeyModifier.none, commands), binding,
		'a graph without an expandable selection still owns its binding');
	inputFocus.executeCommand(binding.command);
	assert.equal(folds, 1);
	const field = new TextField(graph);
	field.focusTarget.focus();
	assert.equal(resolveEditorCommandKeybinding('Space', KeyModifier.none, commands), null,
		'text input does not inherit the graph shortcut');
	field.focusTarget.release();
	assert.equal(inputFocus.target, graph);
	graph.release();
	assert.equal(resolveEditorCommandKeybinding('Space', KeyModifier.none, commands), null);
});

test('BT Delete belongs to graph focus, does not repeat, and cannot consume text-field or gameplay input', t => {
	t.after(() => inputFocus.setTarget(null));
	const graph = inputFocus.createTarget();
	let enabled = true;
	let removals = 0;
	graph.registerCommand('behaviorLens.removeChild', {
		isEnabled: () => enabled,
		run: () => { removals += 1; },
	});
	const commands = { isEnabled: () => true };
	graph.focus();
	const binding = resolveEditorCommandKeybinding('Delete', KeyModifier.none, commands)!;
	assert.equal(binding.command, 'behaviorLens.removeChild');
	assert.notEqual(binding.repeat, true);
	inputFocus.executeCommand(binding.command);
	assert.equal(removals, 1);
	for (const modifier of [KeyModifier.ctrl, KeyModifier.meta, KeyModifier.shift, KeyModifier.alt]) {
		assert.equal(resolveEditorCommandKeybinding('Delete', modifier, commands), null);
	}
	enabled = false;
	inputFocus.executeCommand(binding.command);
	assert.equal(removals, 1);
	const field = new TextField(graph);
	field.focusTarget.focus();
	assert.equal(resolveEditorCommandKeybinding('Delete', KeyModifier.none, commands), null, 'no parent binding inheritance');
	field.focusTarget.release();
	graph.release();
	assert.equal(resolveEditorCommandKeybinding('Delete', KeyModifier.none, commands), null);
});

test('input history restores content and selection, replaces selection as one operation, and publishes changes', () => {
	const field = new TextField();
	let changes = 0;
	field.onDidChangeText(() => { changes += 1; });
	setFieldText(field, 'original', true);
	selectAll(field);
	insertValue(field, 'replacement');
	assert.equal(changes, 1);
	field.undo();
	assert.equal(field.text, 'original');
	assert.deepEqual(field.selectionAnchor, { row: 0, column: 0 });
	assert.equal(field.cursorColumn, 8);
	assert.equal(field.canUndo, false);
	field.redo();
	assert.equal(field.text, 'replacement');
	assert.equal(field.selectionAnchor, null);
	field.undo();
	insertValue(field, 'branch');
	assert.equal(field.canRedo, false);
	assert.equal(changes, 5);
	setFieldText(field, '', true);
	assert.equal(backspace(field), false);
	assert.equal(field.canUndo, false);
	assert.equal(changes, 5, 'programmatic reset and no-op input create no edit event');
});

test('multi-line clipboard text and cursor-only input preserve control-history boundaries', () => {
	const field = new TextField();
	setFieldText(field, 'left\nright', true);
	setCursorFromOffset(field, 5);
	insertValue(field, 'x');
	assert.equal(field.text, 'left\nxright');
	field.undo();
	assert.deepEqual([field.cursorRow, field.cursorColumn], [1, 0]);
	field.redo();
	assert.deepEqual([field.cursorRow, field.cursorColumn], [1, 1]);
	setCursorFromOffset(field, 0);
	assert.equal(backspace(field), false);
	field.undo();
	assert.equal(field.text, 'left\nright');
	assert.equal(field.canUndo, false);
});

test('a busy readonly input retains history without admitting edits or history commands', () => {
	const field = new TextField();
	insertValue(field, 'path.lua');
	field.readOnly = true;
	assert.equal(field.canUndo, false);
	assert.equal(insertValue(field, 'x'), false);
	assert.equal(backspace(field), false);
	field.undo();
	assert.equal(field.text, 'path.lua');
	field.readOnly = false;
	field.undo();
	assert.equal(field.text, '');
});

test('the view declares a retained focus order; controls without an order keep their own Tab semantics', () => {
	const focus = new InputFocusService();
	const view = focus.createTarget();
	const x = focus.createTarget(view);
	const z = focus.createTarget(view);
	view.next = x; x.next = z; z.next = view;
	view.previous = z; z.previous = x; x.previous = view;
	view.focus();
	assert.equal(focus.moveFocus(false), true);
	assert.equal(focus.target, x);
	assert.equal(focus.moveFocus(false), true);
	assert.equal(focus.target, z);
	assert.equal(focus.moveFocus(true), true);
	assert.equal(focus.target, x);
	assert.equal(focus.moveFocus(true), true);
	assert.equal(focus.target, view);
	const code = focus.createTarget();
	code.focus();
	assert.equal(focus.moveFocus(false), false);
	assert.equal(focus.target, code);
	focus.setTarget(null);
	assert.equal(focus.moveFocus(true), false);
});
