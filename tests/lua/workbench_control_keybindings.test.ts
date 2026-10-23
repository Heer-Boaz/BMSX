import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { handleEditorCommandBindings } from '../../ide/input/keyboard/global_bindings';

function fixture(t: TestContext, scope = new InputFocusScope(Symbol('control')), focusReturn: InputFocusTarget | null = null) {
	const parent = inputFocus.createTarget(focusReturn, scope);
	parent.bindKeyboard(() => {});
	const accepted: string[] = [], executed: EditorCommandId[] = [], checked: EditorCommandId[] = [];
	const control = new ValueInput(parent, {
		options: { allowSpace: true, singleLine: true }, invalidBlurMessage: 'Draft rejected',
		format: (value: string) => value, parse: text => ({ value: text }),
	}, value => accepted.push(value));
	control.setValue('123456'); control.field.focusTarget.focus();
	const commands: EditorCommandRunner = {
		isEnabled(command) { checked.push(command); return command !== 'scenarioLab.run'; },
		execute(command) { executed.push(command); },
	};
	inputFocus.workbenchScope.commands = commands;
	t.after(() => { control.cancel(); inputFocus.setTarget(null); control.dispose(); inputFocus.workbenchScope.commands = undefined; });
	return { parent, control, commands, scope, accepted, executed, checked };
}

for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) test(`a focused control routes ${primary === KeyModifier.ctrl ? 'Ctrl' : 'Cmd'} Undo and both Redo bindings to its actual draft history`, t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	insertValue(f.control.field, '1234567');
	for (const [code, modifiers, expected, repeat] of [
		['KeyZ', primary, '123456', false],
		['KeyZ', primary | KeyModifier.shift, '1234567', false],
		['KeyZ', primary, '123456', true],
		['KeyY', primary, '1234567', false],
	] as const) {
		const event = new KeyInputEvent(code, modifiers, repeat);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, target), true);
		assert.equal(event.consumed, true); assert.equal(f.control.field.text, expected);
	}
	assert.deepEqual(f.accepted, [], 'local Undo/Redo never accepts the property or writes its source');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('empty or read-only local history consumes its binding without borrowing underlying document Undo', t => {
	const f = fixture(t, inputFocus.workbenchScope), target = f.control.field.focusTarget;
	assert.equal(inputFocus.commandRunner, f.commands);
	let documentUndos = 0;
	f.parent.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndos++; } });
	target.commandContext = f.parent;
	const empty = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(empty, inputFocus.commandRunner, target), true);
	assert.equal(empty.consumed, true); assert.equal(f.control.field.text, '123456');
	insertValue(f.control.field, '1234567'); f.control.field.readOnly = true;
	const readOnly = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(readOnly, inputFocus.commandRunner, target), true);
	assert.equal(readOnly.consumed, true); assert.equal(f.control.field.text, '1234567');
	assert.equal(documentUndos, 0); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('an actual control owns its history even when its commandContext alias has no Undo command', t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	target.commandContext = f.parent;
	assert.equal(f.parent.getCommand('undo'), undefined);
	insertValue(f.control.field, '1234567');
	const event = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, target), true);
	assert.equal(event.consumed, true); assert.equal(f.control.field.text, '123456');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('a menu commandContext alias cannot admit the underlying field history as its own keyboard command', t => {
	const f = fixture(t), source = new TextField();
	setFieldText(source, 'source before', true); insertValue(source, ' changed');
	const menu = inputFocus.createTarget(null, new InputFocusScope(Symbol('menu'))); menu.commandContext = source.focusTarget; menu.focus();
	assert.equal(source.canUndo, true); assert.equal(menu.getCommand('undo'), undefined);
	const event = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, menu), false);
	assert.equal(event.consumed, false); assert.equal(source.text, 'source before changed');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('an available application runner does not make an aliased field command applicable to the focused toolbar', t => {
	const f = fixture(t, inputFocus.workbenchScope), source = new TextField(f.parent);
	setFieldText(source, 'source before', true); insertValue(source, ' changed');
	let contextMenus = 0;
	source.focusTarget.registerCommand('contextMenu', { isEnabled: () => true, run: () => { contextMenus++; } });
	const toolbar = inputFocus.createTarget(f.parent);
	toolbar.commandContext = source.focusTarget; toolbar.focus();
	assert.equal(inputFocus.commandRunner, f.commands);
	assert.equal(source.canUndo, true);
	assert.equal(toolbar.getCommand('undo'), undefined); assert.equal(toolbar.getCommand('contextMenu'), undefined);
	for (const [code, modifiers] of [['KeyZ', KeyModifier.ctrl], ['ContextMenu', KeyModifier.none]] as const) {
		const event = new KeyInputEvent(code, modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), false);
		assert.equal(event.consumed, false);
	}
	assert.equal(source.text, 'source before changed'); assert.equal(contextMenus, 0);
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('isolated controls cannot route workbench Save, runtime or palette commands', t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	assert.equal(inputFocus.workbenchScope.commands, f.commands, 'a real application runner exists outside this control scope');
	assert.equal(inputFocus.commandRunner, undefined, 'the isolated focus ancestry has no route to that application');
	insertValue(f.control.field, '1234567');
	for (const [code, modifiers] of [
		['KeyS', KeyModifier.ctrl], ['F5', KeyModifier.none], ['KeyP', KeyModifier.ctrl | KeyModifier.shift],
	] as const) {
		const event = new KeyInputEvent(code, modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, target), false);
		assert.equal(event.consumed, false);
		target.handleKeyboard(event);
		assert.equal(f.control.field.text, '1234567');
	}
	assert.deepEqual(f.accepted, []); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('a property popup inherits its actual isolated command owner, not its focus-return target or command alias', t => {
	const isolatedOwner = new InputFocusScope(Symbol('modal owner'));
	const popupScope = new InputFocusScope(Symbol('property popup'), isolatedOwner);
	const workbenchReturn = inputFocus.createTarget();
	const f = fixture(t, popupScope, workbenchReturn);
	f.control.field.focusTarget.commandContext = workbenchReturn;
	assert.equal(f.control.field.focusTarget.scope, popupScope);
	assert.equal(f.parent.parent, workbenchReturn);
	assert.equal(inputFocus.workbenchScope.commands, f.commands);
	assert.equal(inputFocus.commandRunner, undefined);
	insertValue(f.control.field, '1234567');
	const undo = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(undo, inputFocus.commandRunner), true);
	assert.equal(f.control.field.text, '123456');
	const palette = new KeyInputEvent('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(handleEditorCommandBindings(palette, inputFocus.commandRunner), false);
	assert.equal(palette.consumed, false); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('an owned property popup resolves live workbench bindings and retires them when their actual owner unbinds', t => {
	const ownerScope = new InputFocusScope(Symbol('pane'), inputFocus.workbenchScope);
	const popupScope = new InputFocusScope(Symbol('property popup'), ownerScope);
	const f = fixture(t, popupScope);
	inputFocus.workbenchScope.commands = undefined;
	assert.equal(inputFocus.commandRunner, undefined);
	const beforeBinding = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(beforeBinding, inputFocus.commandRunner), false);
	inputFocus.workbenchScope.commands = f.commands;
	assert.equal(inputFocus.commandRunner, f.commands);
	const save = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(save, inputFocus.commandRunner), true);
	assert.deepEqual(f.executed, ['save']);
	const nearerCalls: EditorCommandId[] = [];
	const nearer: EditorCommandRunner = { isEnabled: () => true, execute: command => { nearerCalls.push(command); } };
	ownerScope.commands = nearer;
	assert.equal(inputFocus.commandRunner, nearer);
	const palette = new KeyInputEvent('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(handleEditorCommandBindings(palette, inputFocus.commandRunner), true);
	assert.deepEqual(nearerCalls, ['commandPalette']); assert.deepEqual(f.executed, ['save']);
	inputFocus.workbenchScope.commands = undefined;
	assert.equal(inputFocus.commandRunner, nearer, 'an unrelated root teardown cannot remove the nearer owner');
	ownerScope.commands = undefined;
	assert.equal(inputFocus.commandRunner, undefined);
	const afterTeardown = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(afterTeardown, inputFocus.commandRunner), false);
	insertValue(f.control.field, '1234567');
	const undo = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(undo, inputFocus.commandRunner), true);
	assert.equal(f.control.field.text, '123456', 'unbinding application commands cannot disable the control-owned draft history');
});

test('the ordinary workbench route still resolves and executes global bindings through its actual scope runner', t => {
	const f = fixture(t, inputFocus.workbenchScope);
	assert.equal(inputFocus.commandRunner, f.commands);
	for (const [code, modifiers, command] of [
		['KeyS', KeyModifier.ctrl, 'save'], ['F5', KeyModifier.none, 'debugContinue'],
		['KeyP', KeyModifier.ctrl | KeyModifier.shift, 'commandPalette'],
	] as const) {
		const event = new KeyInputEvent(code, modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), true);
		assert.equal(event.consumed, true); assert.equal(f.executed.at(-1), command);
	}
	assert.deepEqual(f.executed, ['save', 'debugContinue', 'commandPalette']);
	assert.ok(f.checked.includes('save')); assert.ok(f.checked.includes('debugContinue'));
	assert.ok(f.checked.includes('commandPalette'));
});

test('key releases and consumed events do not repeat a control command', t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	insertValue(f.control.field, '1234567');
	const release = new KeyInputEvent('KeyZ', KeyModifier.ctrl, false, false);
	assert.equal(handleEditorCommandBindings(release, inputFocus.commandRunner, target), false);
	const consumed = new KeyInputEvent('KeyZ', KeyModifier.ctrl); consumed.consumed = true;
	assert.equal(handleEditorCommandBindings(consumed, inputFocus.commandRunner, target), false);
	assert.equal(f.control.field.text, '1234567'); assert.deepEqual(f.executed, []);
});
