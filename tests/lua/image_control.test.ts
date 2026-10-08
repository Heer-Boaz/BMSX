import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyModifier } from '../../hosts/common/input/player';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchImageControl } from '../../ide/workbench/ui/image_control';
import { WorkbenchImageViewport } from '../../ide/workbench/ui/image_viewport';

function fixture(t: TestContext) {
	const view = new WorkbenchImageViewport();
	view.setImage(800, 600);
	view.layout(20, 30, 223, 133);
	view.setScale(1);
	view.horizontal.setScroll(200); view.vertical.setScroll(100);
	const focus = new InputFocusService(), capture = new PointerCaptureService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const control = new WorkbenchImageControl(focus, capture, parent);
	control.setInput(view);
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0): PointerSnapshot => {
		const snapshot = { viewportX: x, viewportY: y, valid: true, insideViewport: true,
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
	assert.equal(f.control.handleWheel(pointer, 25, -1, KeyModifier.none), true);
	assert.equal(f.view.vertical.getScroll(), 125);
	assert.equal(f.control.handleWheel(pointer, 40, -1, KeyModifier.shift), true);
	assert.equal(f.view.horizontal.getScroll(), 240);
	const transform = f.view.transform;
	const sourceX = (80 - transform.offsetX) / transform.scale;
	const sourceY = (70 - transform.offsetY) / transform.scale;
	assert.equal(f.control.handleWheel(pointer, -40, 1, KeyModifier.ctrl), true);
	assert.equal(f.view.scale, 2);
	assert.equal((80 - f.view.transform.offsetX) / f.view.scale, sourceX);
	assert.equal((70 - f.view.transform.offsetY) / f.view.scale, sourceY);
	assert.equal(f.control.handleWheel(pointer, 40, -1, KeyModifier.meta), true);
	assert.equal(f.view.scale, 1);
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.control.handleWheel({ ...pointer, viewportX: 10 }, 40, -1, KeyModifier.none), false);
});

test('image navigation and zoom consume real keyboard edges only through image focus', t => {
	const f = fixture(t);
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	let pressId = 0;
	const press = (code: string) => {
		let consumed = false;
		for (const down of [true, false]) {
			input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
			clock.advance(20); input.pollInput(); f.focus.handleKeyboard(input.getPlayerInput(1));
			if (down) consumed = input.getPlayerInput(1).inputHandlers.keyboard!.getKeyState(code).consumed;
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
