import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../ide/workbench/render/action_bar';

function fixture(t: TestContext) {
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const content = focus.createTarget();
	content.bindKeyboard(() => {});
	const state = createWorkbenchActionBar('sourceEditReview.title');
	layoutWorkbenchActionBar(state, 240, 10, 22, text => text.length * 4);
	const enabled = new Set(state.items.map(item => item.command));
	const calls: EditorCommandId[] = [];
	let onExecute = (_command: EditorCommandId) => {};
	const commands: EditorCommandRunner = {
		isEnabled: command => enabled.has(command),
		execute: command => { calls.push(command); onExecute(command); },
	};
	const bar = new WorkbenchActionBarControl(focus, capture, commands, content);
	bar.setInput(state, content);
	content.next = bar.focusTarget; content.previous = bar.focusTarget;
	bar.focusTarget.next = content; bar.focusTarget.previous = content;
	content.focus();
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const player = input.getPlayerInput(1);
	let pressId = 0;
	const frame = () => { clock.advance(20); input.pollInput(); focus.handleKeyboard(player); };
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		frame();
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (index: number, pressed = 0, down = 0, up = 0, blocked = false) => {
		const bounds = index < 0 ? { left: 0, right: 4 } : state.items[index].bounds;
		const snapshot: PointerSnapshot = { valid: true, insideViewport: true,
			viewportX: (bounds.left + bounds.right) / 2, viewportY: 16,
			pressedButtons: pressed, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(snapshot, blocked, clock.now())) bar.handlePointer(snapshot);
	};
	t.after(() => { bar.dispose(); focus.setTarget(null); });
	return { focus, capture, content, state, enabled, calls, commands, bar, input, player, frame, key, press, pointer,
		execute: (callback: (command: EditorCommandId) => void) => { onExecute = callback; } };
}

const PRIMARY = PointerButton.Primary;

test('ordinary actions commit on matching primary release, not down, hover or repeat', t => {
	const f = fixture(t);
	f.pointer(0, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, true);
	assert.equal(f.focus.target, f.content, 'a toolbar press must not blur a value draft');
	assert.equal(f.state.pressedCommand, f.state.items[0].command);
	for (let index = 0; index < 100; index += 1) f.pointer(0, PRIMARY);
	assert.deepEqual(f.calls, []);
	f.pointer(0, 0, 0, PRIMARY);
	assert.deepEqual(f.calls, [f.state.items[0].command]);
	assert.equal(f.capture.active, false);
	f.pointer(0, 0, 0, PRIMARY);
	assert.equal(f.calls.length, 1, 'unmatched releases cannot invoke a command');
});

test('moving out/back changes press feedback; release outside or on another action cancels', t => {
	const f = fixture(t);
	f.pointer(0, PRIMARY, PRIMARY); f.pointer(-1, PRIMARY);
	assert.equal(f.state.pressedCommand, null);
	f.pointer(0, PRIMARY);
	assert.equal(f.state.pressedCommand, f.state.items[0].command);
	f.pointer(0, 0, 0, PRIMARY);
	assert.equal(f.calls.length, 1);
	for (const destination of [-1, 1]) {
		f.pointer(0, PRIMARY, PRIMARY); f.pointer(destination, 0, 0, PRIMARY);
	}
	assert.equal(f.calls.length, 1);
});

test('secondary and auxiliary presses never arm; coalesced primary click executes once', t => {
	const f = fixture(t);
	for (const button of [PointerButton.Secondary, PointerButton.Auxiliary]) {
		f.pointer(0, button, button); f.pointer(0, 0, 0, button);
	}
	assert.deepEqual(f.calls, []);
	f.pointer(0, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.calls, [f.state.items[0].command]);
	assert.equal(f.capture.active, false);
});

test('disable during press revokes the attempt, including later re-enable and release', t => {
	const f = fixture(t);
	f.pointer(0, PRIMARY, PRIMARY);
	f.enabled.delete(f.state.items[0].command); f.bar.update();
	assert.equal(f.capture.active, false);
	f.enabled.add(f.state.items[0].command); f.pointer(0, 0, 0, PRIMARY);
	assert.deepEqual(f.calls, []);
	f.enabled.delete(f.state.items[0].command); f.pointer(0, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, false);
});

test('blur, capture replacement, blocking, lost input and input detach cancel without executing', t => {
	const f = fixture(t);
	const elsewhere = f.focus.createTarget();
	for (const cancel of [
		() => elsewhere.focus(), () => f.capture.cancel(),
		() => f.pointer(0, PRIMARY, 0, 0, true), () => f.pointer(0),
		() => f.bar.clearInput(),
		() => f.bar.setInput(createWorkbenchActionBar('sceneEditor.title'), f.content),
	]) {
		f.bar.setInput(f.state, f.content); f.content.focus();
		f.pointer(0, PRIMARY, PRIMARY); cancel();
		assert.equal(f.capture.active, false);
		assert.equal(f.state.pressedCommand, null);
		f.bar.setInput(f.state, f.content); f.pointer(0, 0, 0, PRIMARY);
	}
	assert.deepEqual(f.calls, []);
});

test('toolbar is one focus stop, with roving enabled actions and content Escape', t => {
	const f = fixture(t);
	f.enabled.delete(f.state.items[1].command);
	assert.equal(f.focus.moveFocus(false), true);
	assert.equal(f.state.hasFocus, true);
	assert.equal(f.state.focusedIndex, 0);
	f.press('ArrowRight'); assert.equal(f.state.focusedIndex, 2);
	f.press('ArrowRight'); assert.equal(f.state.focusedIndex, 0);
	f.press('End'); assert.equal(f.state.focusedIndex, 2);
	f.press('Home'); assert.equal(f.state.focusedIndex, 0);
	f.press('ArrowLeft'); assert.equal(f.state.focusedIndex, 2);
	f.press('Escape'); assert.equal(f.focus.target, f.content);
	assert.equal(f.state.hasFocus, false);
	f.focus.moveFocus(true); assert.equal(f.state.focusedIndex, 2, 're-entry remembers the last focused action');
	f.focus.moveFocus(true); assert.equal(f.focus.target, f.content);
});

test('Enter, NumpadEnter and Space pair down/up once; holding does not repeat', t => {
	const f = fixture(t); f.bar.focusTarget.focus();
	for (const key of ['Enter', 'NumpadEnter', 'Space']) {
		const before = f.calls.length;
		f.key(key, true);
		for (let count = 0; count < 60; count += 1) f.frame();
		assert.equal(f.calls.length, before);
		assert.equal(f.state.pressedCommand, f.state.items[0].command);
		f.key(key, false); assert.equal(f.calls.length, before + 1);
		f.key(key, false); assert.equal(f.calls.length, before + 1);
	}
});

test('keyboard navigation, blur, Escape, input replacement and disable revoke a trigger', t => {
	const f = fixture(t);
	for (const cancel of [
		() => f.press('ArrowRight'), () => f.press('Escape'), () => f.content.focus(),
		() => { f.enabled.clear(); f.bar.update(); },
		() => { f.bar.clearInput(); f.bar.setInput(f.state, f.content); },
	]) {
		for (const item of f.state.items) f.enabled.add(item.command);
		f.bar.focusTarget.focus(); f.key('Space', true); cancel();
		for (const item of f.state.items) f.enabled.add(item.command);
		f.bar.focusTarget.focus(); f.key('Space', false);
		assert.deepEqual(f.calls, []);
	}
});

test('modified trigger keys are not toolbar actions and do not arm a later unmodified release', t => {
	const f = fixture(t); f.bar.focusTarget.focus();
	for (const modifier of ['ControlLeft', 'MetaLeft', 'AltLeft', 'ShiftLeft']) {
		f.key(modifier, true); f.key('Space', true);
		f.key(modifier, false); f.key('Space', false);
		assert.deepEqual(f.calls, []);
	}
});

test('callbacks see cleared capture and may synchronously detach or replace the control', t => {
	const f = fixture(t);
	f.execute(() => {
		assert.equal(f.capture.active, false);
		assert.equal(f.state.pressedCommand, null);
		f.bar.clearInput();
	});
	f.pointer(0, PRIMARY, PRIMARY); f.pointer(0, 0, 0, PRIMARY);
	f.bar.setInput(f.state, f.content); f.bar.focusTarget.focus(); f.press('Enter');
	assert.equal(f.calls.length, 2);
	assert.equal(f.focus.target, f.content);
});

test('a toolbar carries explicit command context, but children never inherit parent commands', t => {
	const f = fixture(t);
	let undos = 0;
	f.content.registerCommand('undo', { isEnabled: () => true, run: () => { undos += 1; } });
	f.bar.focusTarget.focus(); f.focus.executeCommand('undo');
	assert.equal(undos, 1);
	const field = f.focus.createTarget(f.content); field.focus();
	assert.equal(f.focus.getCommand('undo'), undefined);
	f.focus.executeCommand('undo'); assert.equal(undos, 1);
	field.registerCommand('undo', { isEnabled: () => false, run: () => assert.fail('disabled field command') });
	f.focus.executeCommand('undo'); assert.equal(undos, 1);
});

test('unchanged frames keep item storage, geometry and focus identity', t => {
	const f = fixture(t);
	const items = f.state.items, bounds = items[0].bounds, focus = f.bar.focusTarget;
	f.bar.focusTarget.focus();
	for (let index = 0; index < 1000; index += 1) { f.bar.setInput(f.state, f.content); f.bar.update(); f.pointer(0); }
	assert.equal(f.state.items, items); assert.equal(items[0].bounds, bounds);
	assert.equal(f.focus.target, focus); assert.equal(f.state.hasFocus, true);
	assert.deepEqual(f.calls, []);
});

test('tiny-font rendering distinguishes hover, keyboard focus, pressed and disabled, retaining draw storage', t => {
	const f = fixture(t);
	const font = new Font({ variant: 'tiny' });
	const overlay = createHostOverlayFixture(256, 212);
	const stream = new HostOverlayQuadStream();
	layoutWorkbenchActionBar(f.state, 240, 10, 22, text => font.measure(text));
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		renderWorkbenchActionBar(f.state, f.commands, font); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); stream.reset(256, 212);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
	};
	draw(); const storage = stream.floatData;
	const ordinary = storage.slice();
	f.pointer(0); draw(); const hover = storage.slice();
	assert.notDeepEqual(hover, ordinary);
	f.bar.focusTarget.focus(); draw(); const focused = storage.slice();
	assert.notDeepEqual(focused, hover);
	f.key('Space', true); draw(); const pressed = storage.slice();
	assert.notDeepEqual(pressed, focused);
	f.enabled.clear(); f.bar.update(); draw(); const disabled = storage.slice();
	assert.notDeepEqual(disabled, pressed);
	for (let index = 0; index < 100; index += 1) draw();
	assert.equal(stream.floatData, storage);
	assert.deepEqual(storage, disabled);
	assert.equal(f.calls.length, 0);
});
