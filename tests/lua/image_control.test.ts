import { KeyInputEvent } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { consumeIdeKey, isKeyJustPressed } from '../../ide/input/keyboard/key_input';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchImageControl } from '../../ide/workbench/ui/image_control';
import { WorkbenchImageViewport } from '../../ide/workbench/ui/image_viewport';

function fixture(t: TestContext, keyboard?: (event: KeyInputEvent) => boolean) {
	const view = new WorkbenchImageViewport();
	view.setImage(800, 600);
	view.layout(20, 30, 223, 133);
	view.setScale(1);
	view.horizontal.setScroll(200); view.vertical.setScroll(100);
	const focus = new InputFocusService(), capture = new PointerCaptureService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const control = new WorkbenchImageControl(focus, capture, parent, undefined, keyboard);
	control.setInput(view);
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0): PointerInputSnapshot => {
		const snapshot = { modifiers: KeyModifier.none, spaceDown: false, viewportX: x, viewportY: y, valid: true, insideViewport: true,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(snapshot, false, 0)) control.handlePointer(snapshot);
		return snapshot;
	};
	t.after(() => control.dispose());
	return { view, focus, capture, parent, control, pointer };
}

for (const button of [PointerButton.Primary, PointerButton.Auxiliary]) {
	test(`image pan button ${button} keeps fractional motion and applies the final release outside the image viewport`, t => {
		const f = fixture(t);
		f.pointer(80, 70, button, button);
		assert.equal(f.focus.target, f.control.focusTarget);
		assert.equal(f.capture.active, true);
		f.pointer(50.5, 49.25, button);
		assert.equal(f.view.horizontal.getScroll(), 229.5);
		assert.equal(f.view.vertical.getScroll(), 120.75);
		f.pointer(10, 20, 0, 0, button);
		assert.equal(f.view.horizontal.getScroll(), 270);
		assert.equal(f.view.vertical.getScroll(), 150);
		assert.equal(f.capture.active, false);
		f.pointer(80, 70, 0, button, button);
		assert.equal(f.capture.active, false, 'coalesced press/release cannot leave a pan captured');
	});
}

test('image pan loses capture on blur, image replacement, geometry change and detach', t => {
	const f = fixture(t), primary = PointerButton.Primary;
	for (const cancel of [
		() => f.parent.focus(),
		() => f.view.setImage(800, 600),
		() => f.view.layout(21, 30, 224, 133),
		() => f.control.clearInput(),
	]) {
		f.view.layout(20, 30, 223, 133); f.view.setScale(1); f.control.setInput(f.view);
		f.pointer(80, 70, primary, primary);
		assert.equal(f.capture.active, true);
		cancel();
		assert.equal(f.capture.active, false);
	}
});

test('image scrollbar capture does not take focus and wheel modifiers route through viewport owners', t => {
	const f = fixture(t), primary = PointerButton.Primary;
	f.pointer(221, 60, primary, primary);
	assert.equal(f.capture.active, true);
	assert.equal(f.focus.target, f.parent);
	f.pointer(50, 100, 0, 0, primary);
	assert.equal(f.capture.active, false);
	f.view.horizontal.setScroll(200); f.view.vertical.setScroll(100);
	const pointer = f.pointer(80, 70);
	const wheel = { ...pointer, deltaX: 0, deltaY: 25 / 16, modifiers: KeyModifier.none, spaceDown: false };
	assert.equal(f.control.handleWheel(wheel), true);
	assert.equal(f.view.vertical.getScroll(), 125);
	assert.equal(f.control.handleWheel({ ...wheel, deltaY: 2.5, modifiers: KeyModifier.shift }), true);
	assert.equal(f.view.horizontal.getScroll(), 240);
	const transform = f.view.transform;
	const sourceX = (80 - transform.offsetX) / transform.scale;
	const sourceY = (70 - transform.offsetY) / transform.scale;
	assert.equal(f.control.handleWheel({ ...wheel, deltaY: -1, modifiers: KeyModifier.ctrl }), true);
	assert.equal(f.view.scale, 2);
	assert.equal((80 - f.view.transform.offsetX) / f.view.scale, sourceX);
	assert.equal((70 - f.view.transform.offsetY) / f.view.scale, sourceY);
	assert.equal(f.control.handleWheel({ ...wheel, deltaY: 1, modifiers: KeyModifier.meta }), true);
	assert.equal(f.view.scale, 1);
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.control.handleWheel({ ...wheel, viewportX: 10 }), false);
});

test('fractional image wheel pans both axes and zooms continuously around the source pixel', t => {
	const f = fixture(t);
	const wheel = { ...f.pointer(80, 70), deltaX: 0.125, deltaY: -0.25, modifiers: KeyModifier.none, spaceDown: false };
	f.control.handleWheel(wheel);
	assert.equal(f.view.horizontal.getScroll(), 202);
	assert.equal(f.view.vertical.getScroll(), 96);
	f.control.handleWheel({ ...wheel, modifiers: KeyModifier.shift });
	assert.equal(f.view.horizontal.getScroll(), 204, 'already-horizontal trackpad input is not remapped a second time');
	assert.equal(f.view.vertical.getScroll(), 92);
	const sourceX = (wheel.viewportX - f.view.transform.offsetX) / f.view.scale;
	const sourceY = (wheel.viewportY - f.view.transform.offsetY) / f.view.scale;
	for (const modifier of [KeyModifier.ctrl, KeyModifier.meta]) {
		f.control.handleWheel({ ...wheel, deltaX: 0, deltaY: -0.5, modifiers: modifier });
		assert.ok(Math.abs(f.view.scale - Math.SQRT2) < 1e-10);
		assert.ok(Math.abs((wheel.viewportX - f.view.transform.offsetX) / f.view.scale - sourceX) < 1e-10);
		assert.ok(Math.abs((wheel.viewportY - f.view.transform.offsetY) / f.view.scale - sourceY) < 1e-10);
		f.control.handleWheel({ ...wheel, deltaX: 0, deltaY: 0.5, modifiers: modifier });
		assert.ok(Math.abs(f.view.scale - 1) < 1e-10);
	}
	f.view.setScale('fit');
	f.control.handleWheel({ ...wheel, deltaY: 0, modifiers: KeyModifier.ctrl });
	assert.equal(f.view.mode, 'fit', 'horizontal-only wheel does not replace Fit with a numeric scale');
	f.view.setScale(1.25);
	f.view.zoomBySteps(1);
	assert.equal(f.view.scale, 2, 'keyboard/menu zoom still selects the next exact pixel preset');
});

test('image navigation and zoom consume real keyboard edges only through image focus', t => {
	const f = fixture(t);
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	let pressId = 0;
	const press = (code: string) => {
		let consumed = false;
		for (const down of [true, false]) {
			input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
			clock.advance(20); input.pollInput(); const event = new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down); f.focus.handleKeyboard(event);
			if (down) consumed = event.consumed;
		}
		return consumed;
	};
	assert.equal(press('ArrowDown'), false);
	assert.equal(f.view.vertical.getScroll(), 100);
	f.control.focusTarget.focus();
	assert.equal(press('Home'), true);
	assert.equal(f.view.horizontal.getScroll(), 0); assert.equal(f.view.vertical.getScroll(), 0);
	assert.equal(press('PageDown'), true); assert.equal(f.view.vertical.getScroll(), 100);
	assert.equal(press('ArrowRight'), true); assert.equal(f.view.horizontal.getScroll(), 16);
	assert.equal(press('ArrowUp'), true); assert.equal(f.view.vertical.getScroll(), 84);
	assert.equal(press('Equal'), true); assert.equal(f.view.scale, 2);
	assert.equal(press('Minus'), true); assert.equal(f.view.scale, 1);
	assert.equal(press('NumpadAdd'), true); assert.equal(f.view.scale, 2);
	assert.equal(press('NumpadSubtract'), true); assert.equal(f.view.scale, 1);
	assert.equal(press('End'), true);
	assert.equal(f.view.horizontal.getScroll(), 600); assert.equal(f.view.vertical.getScroll(), 500);
	assert.equal(press('KeyA'), false, 'unowned gameplay/typing keys are not swallowed');
	f.control.clearInput(); assert.equal(f.focus.target, f.parent);
});


test('the image owner handles its local escape without replacing image navigation or swallowing unowned keys', t => {
	const f = fixture(t, event => {
		if (!isKeyJustPressed('Escape', event)) return false;
		consumeIdeKey('Escape', event); f.parent.focus(); return true;
	});
	f.control.focusTarget.focus();
	const right = new KeyInputEvent('ArrowRight', KeyModifier.none);
	f.focus.handleKeyboard(right);
	assert.equal(right.consumed, true); assert.equal(f.view.horizontal.getScroll(), 216);
	const typing = new KeyInputEvent('KeyA', KeyModifier.none);
	f.focus.handleKeyboard(typing); assert.equal(typing.consumed, false);
	f.pointer(80, 70, PointerButton.Primary, PointerButton.Primary);
	assert.equal(f.capture.active, true);
	const escape = new KeyInputEvent('Escape', KeyModifier.none);
	f.focus.handleKeyboard(escape);
	assert.equal(escape.consumed, true); assert.equal(f.focus.target, f.parent);
	assert.equal(f.capture.active, false, 'focus-return ends the image pan through the existing blur owner');
});

test('a rejected image focus request consumes its press without starting a pan', t => {
	const f = fixture(t), primary = PointerButton.Primary;
	f.focus.bindScopeAdmission(() => false);
	const handled = f.control.handlePointer({ viewportX: 80, viewportY: 70, valid: true, insideViewport: true,
		pressedButtons: primary, justPressedButtons: primary, justReleasedButtons: 0 });
	assert.equal(handled, true);
	assert.equal(f.capture.active, false);
	assert.ok(f.focus.target === f.parent);
	assert.equal(f.view.horizontal.getScroll(), 200); assert.equal(f.view.vertical.getScroll(), 100);
});

test('shared image commands address only their attached viewport and become unavailable on retirement', t => {
	const f = fixture(t), other = fixture(t);
	f.focus.executeCommand('image.zoomIn', f.control.focusTarget); assert.equal(f.view.mode, 2); assert.equal(other.view.mode, 1);
	f.focus.executeCommand('image.actualSize', f.control.focusTarget); assert.equal(f.view.mode, 1);
	f.focus.executeCommand('image.zoomOut', f.control.focusTarget); assert.equal(f.view.mode, 0.5);
	f.focus.executeCommand('image.fit', f.control.focusTarget); assert.equal(f.view.mode, 'fit');
	for (const command of ['image.zoomIn', 'image.zoomOut', 'image.fit', 'image.actualSize'] as const) {
		assert.equal(f.control.focusTarget.getCommand(command)!.isEnabled(), true);
	}
	f.control.clearInput();
	for (const command of ['image.zoomIn', 'image.zoomOut', 'image.fit', 'image.actualSize'] as const) {
		assert.equal(f.control.focusTarget.getCommand(command)!.isEnabled(), false);
		f.focus.executeCommand(command, f.control.focusTarget);
	}
	assert.equal(f.view.mode, 'fit'); assert.equal(other.view.mode, 1);
});

for (const change of ['detach', 'replace', 'same-view rebind', 'scope retirement'] as const)
test(`image focus-entry ${change} consumes the old press without capturing or panning another attachment`, t => {
	const f = fixture(t), primary = PointerButton.Primary;
	const replacement = new WorkbenchImageViewport();
	replacement.setImage(800, 600); replacement.layout(20, 30, 223, 133); replacement.setScale(1);
	replacement.horizontal.setScroll(300); replacement.vertical.setScroll(150);
	f.parent.onDidBlur(() => {
		if (change === 'detach') f.control.clearInput();
		else if (change === 'replace') f.control.setInput(replacement);
		else if (change === 'same-view rebind') f.control.setInput(f.view);
		else f.control.focusTarget.scope.retireContext();
	});
	f.pointer(80, 70, primary, primary);
	assert.equal(f.capture.active, false);
	const motion = { modifiers: KeyModifier.none, spaceDown: false, viewportX: 60, viewportY: 50,
		valid: true, insideViewport: true, pressedButtons: primary, justPressedButtons: 0, justReleasedButtons: 0 };
	assert.doesNotThrow(() => { assert.equal(f.capture.dispatch(motion, false, 0), false); });
	assert.equal(f.view.horizontal.getScroll(), 200); assert.equal(f.view.vertical.getScroll(), 100);
	assert.equal(replacement.horizontal.getScroll(), 300); assert.equal(replacement.vertical.getScroll(), 150);
});

test('a newer foreign focus and pointer capture during image entry are not replaced or cancelled', t => {
	const f = fixture(t), primary = PointerButton.Primary, foreign = f.focus.createTarget();
	let moves = 0, cancellations = 0;
	const foreignDrag = { handleCapturedPointer: () => { moves++; }, releaseCapturedPointer: () => {}, cancelPointer: () => { cancellations++; } };
	f.parent.onDidBlur(() => { foreign.focus(); f.capture.capture(foreignDrag); });
	f.pointer(80, 70, primary, primary);
	assert.ok(f.focus.admittedTarget === foreign);
	assert.equal(f.capture.active, true);
	f.pointer(60, 50, primary);
	assert.equal(moves, 1); assert.equal(cancellations, 0);
	assert.equal(f.view.horizontal.getScroll(), 200); assert.equal(f.view.vertical.getScroll(), 100);
});

test('clearing an image attachment publishes retirement before blur can bind and focus its replacement', t => {
	const f = fixture(t), primary = PointerButton.Primary;
	const replacement = new WorkbenchImageViewport();
	replacement.setImage(800, 600); replacement.layout(20, 30, 223, 133); replacement.setScale(1);
	replacement.horizontal.setScroll(300); replacement.vertical.setScroll(150);
	f.control.focusTarget.focus();
	const unbind = f.control.focusTarget.onDidBlur(() => {
		unbind(); f.control.setInput(replacement); f.control.focusTarget.focus();
	});
	f.control.clearInput();
	assert.ok(f.focus.admittedTarget === f.control.focusTarget);
	f.pointer(80, 70, primary, primary); f.pointer(60, 50, primary);
	assert.equal(replacement.horizontal.getScroll(), 320); assert.equal(replacement.vertical.getScroll(), 170);
	assert.equal(f.view.horizontal.getScroll(), 200); assert.equal(f.view.vertical.getScroll(), 100);
});
