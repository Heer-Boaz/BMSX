import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { InputFocusScope, InputFocusService, inputFocus } from '../../ide/input/focus';
import { EditorCommandKeybindingController } from '../../ide/input/keyboard/global_bindings';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { createActualSourcePanes } from '../helpers/source_panes';
import { getWorkbenchWorkArea } from '../../ide/workbench/common/layout';

const WINDOW_COMMANDS = ['window.snapLeft', 'window.snapRight', 'window.maximize', 'window.restore'] as const;

function fixture(t: TestContext) {
	const focus = new InputFocusService(), clock = new VirtualHeadlessClock();
	const scope = new InputFocusScope(Symbol('frontend'), focus.workbenchScope);
	const target = focus.createTarget(null, scope); target.bindKeyboard(() => {}); target.focus();
	const controller = new EditorCommandKeybindingController(focus, clock);
	const local: EditorCommandId[] = [], global: EditorCommandId[] = [], enabled = new Set<EditorCommandId>();
	for (const command of WINDOW_COMMANDS) target.registerCommand(command, { isEnabled: () => true, run: () => { local.push(command); } });
	const commands: EditorCommandRunner = {
		isEnabled: command => enabled.has(command),
		execute(command, origin) {
			if (origin?.getCommand(command) !== undefined) focus.executeCommand(command, origin);
			else global.push(command);
		},
	};
	const key = (code: string, modifiers = KeyModifier.none, down = true, repeat = false) => {
		const event = new KeyInputEvent(code, modifiers, repeat, down);
		const handled = controller.handle(event, commands);
		return { event, handled };
	};
	t.after(() => { controller.dispose(); focus.setTarget(null); });
	return { focus, clock, scope, target, controller, local, global, enabled, commands, key };
}

for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) test(`${KeyModifier[primary]} K resolves each actual unmodified second stroke independently`, t => {
	const f = fixture(t);
	for (const [code, command] of [
		['ArrowLeft', 'window.snapLeft'], ['ArrowRight', 'window.snapRight'],
		['ArrowUp', 'window.maximize'], ['ArrowDown', 'window.restore'],
	] as const) {
		const prefix = f.key('KeyK', primary);
		assert.equal(prefix.handled, true); assert.equal(prefix.event.consumed, true); assert.equal(f.controller.inChordMode, true);
		assert.equal(f.key('KeyK', KeyModifier.none, false).event.consumed, false);
		assert.equal(f.key(primary === KeyModifier.ctrl ? 'ControlLeft' : 'MetaLeft', KeyModifier.none, false).event.consumed, false);
		const complete = f.key(code);
		assert.equal(complete.handled, true); assert.equal(complete.event.consumed, true);
		assert.equal(f.controller.inChordMode, false); assert.equal(f.local.at(-1), command);
		assert.equal(f.key(code, KeyModifier.none, false).event.consumed, false);
	}
	assert.deepEqual(f.local, WINDOW_COMMANDS); assert.deepEqual(f.global, []);
});

test('actual binding weights and applicability still resolve before dispatch, while disabled local presence owns its binding', t => {
	const f = fixture(t);
	f.target.registerCommand('scenarioLab.run', { isEnabled: () => true, run: () => { f.local.push('scenarioLab.run'); } });
	f.target.registerCommand('debugContinue', { isEnabled: () => true, run: () => { f.local.push('debugContinue'); } });
	f.key('F5'); assert.equal(f.local.at(-1), 'scenarioLab.run');
	f.target.unregisterCommand('scenarioLab.run'); f.key('F5'); assert.equal(f.local.at(-1), 'debugContinue');
	f.enabled.add('contextMenu');
	assert.equal(f.key('ContextMenu').handled, false, 'a global command cannot satisfy a concrete-control applicability rule');
	f.target.registerCommand('contextMenu', { isEnabled: () => false, run: () => assert.fail('disabled local command ran') });
	assert.equal(f.key('ContextMenu').event.consumed, true); assert.deepEqual(f.global, []);
	f.enabled.add('window.snapLeft');
	f.target.registerCommand('window.snapLeft', { isEnabled: () => false, run: () => assert.fail('disabled chord command ran') });
	f.key('KeyK', KeyModifier.ctrl);
	assert.equal(f.key('ArrowLeft').event.consumed, true); assert.equal(f.controller.inChordMode, false);
	assert.deepEqual(f.global, []); assert.deepEqual(f.local, ['scenarioLab.run', 'debugContinue']);
});

test('prefixes require their exact modifiers and repeats, releases and modifier-only events cannot complete a chord', t => {
	const f = fixture(t);
	for (const modifiers of [KeyModifier.none, KeyModifier.ctrl | KeyModifier.alt, KeyModifier.meta | KeyModifier.shift]) {
		assert.equal(f.key('KeyK', modifiers).handled, false); assert.equal(f.controller.inChordMode, false);
	}
	assert.equal(f.key('KeyK', KeyModifier.ctrl, true, true).handled, false); assert.equal(f.controller.inChordMode, false);
	f.key('KeyK', KeyModifier.ctrl);
	for (const code of ['ControlLeft', 'MetaRight', 'AltLeft', 'ShiftRight']) {
		assert.equal(f.key(code).handled, false); assert.equal(f.key(code, KeyModifier.none, false).handled, false);
		assert.equal(f.controller.inChordMode, true);
	}
	assert.equal(f.key('ArrowLeft', KeyModifier.none, false).handled, false);
	assert.equal(f.key('ArrowLeft', KeyModifier.none, true, true).event.consumed, true);
	assert.equal(f.controller.inChordMode, true); assert.deepEqual(f.local, []);
	f.key('ArrowRight'); assert.deepEqual(f.local, ['window.snapRight']);
});

test('an already consumed event belongs to its producer and cannot start or complete another chord', t => {
	const f = fixture(t), prefix = new KeyInputEvent('KeyK', KeyModifier.ctrl); prefix.consumed = true;
	assert.equal(f.controller.handle(prefix, f.commands), false); assert.equal(f.controller.inChordMode, false);
	f.key('KeyK', KeyModifier.ctrl);
	const second = new KeyInputEvent('ArrowLeft', KeyModifier.none); second.consumed = true;
	assert.equal(f.controller.handle(second, f.commands), false); assert.deepEqual(f.local, []);
	assert.equal(f.controller.inChordMode, true); f.key('ArrowRight'); assert.deepEqual(f.local, ['window.snapRight']);
});

test('a failed plain second stroke is consumed once, whereas modified arrows leave their native routes available', t => {
	const f = fixture(t);
	f.key('KeyK', KeyModifier.ctrl);
	assert.equal(f.key('KeyX').event.consumed, true); assert.equal(f.controller.inChordMode, false);
	assert.equal(f.key('KeyX').handled, false);
	for (const modifiers of [KeyModifier.ctrl | KeyModifier.shift, KeyModifier.alt, KeyModifier.meta]) {
		f.key('KeyK', KeyModifier.ctrl);
		const arrow = f.key('ArrowLeft', modifiers);
		assert.equal(arrow.handled, false); assert.equal(arrow.event.consumed, false); assert.equal(f.controller.inChordMode, false);
	}
	assert.deepEqual(f.local, []); assert.deepEqual(f.global, []);
});

test('Escape and the exact five-second host deadline retire only the pending chord', t => {
	const f = fixture(t);
	f.key('KeyK', KeyModifier.ctrl); assert.equal(f.key('Escape').event.consumed, true);
	assert.equal(f.controller.inChordMode, false); assert.equal(f.key('ArrowLeft').handled, false);
	f.key('KeyK', KeyModifier.ctrl); f.clock.advance(4999);
	assert.equal(f.controller.inChordMode, true);
	f.clock.advance(1); assert.equal(f.controller.inChordMode, false);
	assert.equal(f.key('ArrowLeft').handled, false); assert.deepEqual(f.local, []);
});

test('focus transfer and blocked modal admission cannot revive a prefix when the original control returns', t => {
	const f = fixture(t), other = f.focus.createTarget(); other.bindKeyboard(() => {});
	f.key('KeyK', KeyModifier.ctrl); other.focus();
	assert.equal(f.controller.inChordMode, false); f.target.focus();
	assert.equal(f.key('ArrowLeft').handled, false);
	let admitted = true;
	const unbind = f.focus.bindScopeAdmission(() => admitted); t.after(unbind);
	f.key('KeyK', KeyModifier.ctrl); admitted = false; f.focus.notifyTargetChanged();
	assert.ok(f.focus.target === f.target && f.focus.admittedTarget === null);
	assert.equal(f.controller.inChordMode, false);
	admitted = true; f.focus.notifyTargetChanged();
	assert.equal(f.key('ArrowLeft').handled, false); assert.deepEqual(f.local, []);
});

for (const retirement of ['input', 'scope', 'ancestor'] as const) test(`${retirement} retirement ends the pending owner's authority without a focus transfer`, t => {
	const f = fixture(t), unrelated = new InputFocusScope(Symbol('unrelated'), f.focus.workbenchScope);
	f.key('KeyK', KeyModifier.ctrl); unrelated.retireContext(); assert.equal(f.controller.inChordMode, true);
	if (retirement === 'input') f.focus.cancelInput();
	else if (retirement === 'scope') f.scope.retireContext();
	else f.focus.workbenchScope.retireContext();
	assert.ok(f.focus.target === f.target); assert.equal(f.controller.inChordMode, false);
	assert.equal(f.key('ArrowLeft').handled, false); assert.deepEqual(f.local, []);
});

test('independent frontend controllers own their pending labels without sharing or cancelling another prefix', t => {
	const a = fixture(t), b = fixture(t);
	a.key('KeyK', KeyModifier.ctrl); b.key('KeyK', KeyModifier.meta);
	const waiting = b.controller.pendingLabel;
	assert.notEqual(waiting, undefined);
	a.controller.cancel(); a.clock.advance(5000);
	assert.equal(a.controller.inChordMode, false); assert.equal(b.controller.inChordMode, true);
	assert.equal(a.controller.pendingLabel, undefined); assert.equal(b.controller.pendingLabel, waiting);
	b.key('ArrowRight'); assert.deepEqual(a.local, []); assert.deepEqual(b.local, ['window.snapRight']);
	assert.equal(b.controller.inChordMode, false); assert.equal(b.controller.pendingLabel, undefined);
});

test('disposing a pending controller cancels its timer and cannot clear newer producer feedback', t => {
	const focus = new InputFocusService(), clock = new VirtualHeadlessClock(), target = focus.createTarget();
	target.bindKeyboard(() => {}); target.registerCommand('window.snapLeft', { isEnabled: () => true, run() {} }); target.focus();
	t.after(() => focus.setTarget(null));
	const controller = new EditorCommandKeybindingController(focus, clock);
	controller.handle(new KeyInputEvent('KeyK', KeyModifier.ctrl), undefined);
	assert.notEqual(controller.pendingLabel, undefined);
	const message = 'newer producer feedback'; showEditorMessage(message, 'warning', 10);
	t.after(() => updateEditorMessage(10));
	controller.dispose(); assert.equal(controller.inChordMode, false); clock.advance(5000);
	assert.equal(controller.pendingLabel, undefined);
	assert.equal(editorFeedbackState.message.visible, true); assert.equal(editorFeedbackState.message.text, message);
});

test('the completed prefix retires before command execution can synchronously start another chord', t => {
	const f = fixture(t);
	f.target.registerCommand('window.snapLeft', { isEnabled: () => true, run: () => {
		assert.equal(f.controller.inChordMode, false); f.local.push('window.snapLeft');
		assert.equal(f.key('KeyK', KeyModifier.ctrl).handled, true);
	} });
	f.key('KeyK', KeyModifier.ctrl); f.clock.advance(1000); f.key('ArrowLeft');
	assert.equal(f.controller.inChordMode, true);
	f.clock.advance(4000); assert.equal(f.controller.inChordMode, true, 'the retired prefix timer cannot expire its replacement');
	f.key('ArrowRight'); assert.deepEqual(f.local, ['window.snapLeft', 'window.snapRight']);
	assert.equal(f.controller.inChordMode, false);
});

test('the actual Source frontend dispatches its chord to its own window without leaking the second arrow to the caret', t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy, view = f.firstInput.context.view;
	f.first.focus();
	const source = model.buffer.getText(), version = model.version, row = view.cursorRow, column = view.cursorColumn;
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	const area = { ...getWorkbenchWorkArea() }, bounds = { ...f.firstPart.window!.model.bounds }, requested = { ...f.firstPart.window!.model.requestedBounds };
	f.key('KeyK', KeyModifier.ctrl); assert.equal(f.editor.keybindings.inChordMode, true);
	assert.notEqual(f.editor.keybindings.pendingLabel, undefined);
	assert.deepEqual(getWorkbenchWorkArea(), area, 'the pending-key hint cannot reserve a new status row or change snap eligibility');
	assert.deepEqual(f.firstPart.window!.model.bounds, bounds); assert.deepEqual(f.firstPart.window!.model.requestedBounds, requested);
	f.key('ArrowLeft');
	assert.equal(f.editor.keybindings.inChordMode, false); assert.equal(f.firstPart.window!.model.placement, 'left');
	assert.equal(f.secondPart.window!.model.placement, 'normal');
	assert.ok(f.editor.editorParts.activePart === f.firstPart && inputFocus.target === f.first.code.focusTarget);
	assert.equal(view.cursorRow, row); assert.equal(view.cursorColumn, column); assert.equal(view.selectionAnchor, null);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('a pending window prefix preserves actual native word selection and the existing Alt navigation command', t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy, view = f.firstInput.context.view;
	f.first.focus(); f.first.code.nativeText.setSelection(0, 0);
	const source = model.buffer.getText(), version = model.version;
	f.key('KeyK', KeyModifier.ctrl); f.key('ArrowRight', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.editor.keybindings.inChordMode, false); assert.equal(f.firstPart.window!.model.placement, 'normal');
	assert.ok(view.selectionAnchor !== null && view.cursorColumn > 0, 'the actual Source word-selection handler receives the modified arrow');
	let back = 0;
	f.first.code.focusTarget.registerCommand('navigateBack', { isEnabled: () => true, run: () => { back++; } });
	t.after(() => f.first.code.focusTarget.unregisterCommand('navigateBack'));
	f.key('KeyK', KeyModifier.ctrl); f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(back, 1); assert.equal(f.editor.keybindings.inChordMode, false);
	assert.equal(f.firstPart.window!.model.placement, 'normal');
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
});

test('the actual guest recipient bypasses window prefixes and arrows before any chord is admitted', t => {
	const f = createActualSourcePanes(t), game = new GameViewInput(), model = f.firstInput.workingCopy;
	f.firstGroup.openEditor(game); f.update();
	const bounds = game.frameBounds, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: down ? 0 : 1 });
	const guest = inputFocus.target!, binding = guest.guestInput!;
	assert.ok(binding !== undefined && binding.recipient === f.host.input);
	const source = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	for (const event of [new KeyInputEvent('KeyK', KeyModifier.ctrl), new KeyInputEvent('KeyK', KeyModifier.none, false, false),
		new KeyInputEvent('ArrowLeft', KeyModifier.none), new KeyInputEvent('ArrowUp', KeyModifier.none)]) {
		f.editor.dispatchKey(event);
		assert.equal(event.consumed, false); assert.equal(f.editor.keybindings.inChordMode, false);
		assert.ok(inputFocus.target === guest && guest.guestInput === binding);
	}
	assert.equal(f.firstPart.window!.model.placement, 'normal'); assert.equal(f.secondPart.window!.model.placement, 'normal');
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('new window placement commands cannot retain authority from an actually retired Source document', async t => {
	const f = createActualSourcePanes(t), target = f.first.commandTarget, model = f.secondInput.workingCopy;
	f.second.focus(); assert.equal(await f.editor.editorParts.close(f.firstPart), true);
	const source = model.buffer.getText(), version = model.version, placement = f.secondPart.window!.model.placement;
	const requested = { ...f.secondPart.window!.model.requestedBounds };
	for (const command of WINDOW_COMMANDS) {
		assert.equal(f.editor.commands.isEnabled(command, target), false);
		f.editor.commands.execute(command, target);
	}
	assert.equal(f.secondPart.window!.model.placement, placement); assert.deepEqual(f.secondPart.window!.model.requestedBounds, requested);
	assert.ok(f.editor.editorParts.activePart === f.secondPart && inputFocus.target === f.second.code.focusTarget);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
});
