import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchSlider } from '../../ide/workbench/ui/slider';
import { WorkbenchSliderControl } from '../../ide/workbench/ui/slider_control';

test('slider maps endpoints exactly and retains its geometry through value readbacks', () => {
	const slider = new WorkbenchSlider();
	slider.enabled = true; slider.layout(10, 20, 116, 36); slider.setRange(-10, 90.25, 1);
	assert.equal(slider.valueAt(-100), -10);
	assert.equal(slider.valueAt(1000), 90.25, 'fractional maximum is reachable without a special reset button');
	assert.equal(slider.valueAt(63), 40);
	slider.value = 90.25; assert.equal(slider.valueX, 113);
	slider.value = -10; assert.equal(slider.valueX, 13);
	const revision = slider.revision;
	for (let i = 0; i < 50; i += 1) {
		slider.value = i; slider.layout(10, 20, 116, 36); slider.setRange(-10, 90.25, 1);
	}
	assert.equal(slider.revision, revision);
	slider.setRange(0, 0, 1); assert.equal(slider.interactive, false);
});

test('slider preserves captured input through readback and cancels on geometry, disablement or focus loss', t => {
	const focus = new InputFocusService(), capture = new PointerCaptureService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const values: number[] = []; let cancelled = 0;
	const slider = new WorkbenchSlider(); slider.enabled = true;
	slider.layout(0, 20, 106, 36); slider.setRange(0, 1000.5, 1);
	const control = new WorkbenchSliderControl(focus, capture, parent, value => values.push(value), () => cancelled++);
	control.setInput(slider); t.after(() => control.dispose());
	const button = PointerButton.Primary;
	const pointer = (x: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
		viewportX: x, viewportY: 25, valid: true, insideViewport: true,
		pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
	});
	control.handlePointer(pointer(3, button, button));
	assert.equal(focus.target, control.focusTarget);
	capture.dispatch(pointer(53, button), false, 20);
	const revision = slider.revision;
	slider.value = 250; control.update();
	assert.equal(capture.active, true); assert.equal(slider.revision, revision);
	capture.dispatch(pointer(103, 0, 0, button), false, 40);
	assert.deepEqual(values, [0, 500, 1000.5]); assert.equal(cancelled, 0);
	control.handlePointer(pointer(53, button, button)); parent.focus();
	assert.equal(capture.active, false); assert.equal(cancelled, 1);
	control.handlePointer(pointer(53, button, button)); slider.setRange(0, 2000, 1); control.update();
	assert.equal(capture.active, false); assert.equal(cancelled, 2);
	control.handlePointer(pointer(53, button, button)); slider.enabled = false; control.update();
	assert.equal(capture.active, false); assert.equal(focus.target, parent); assert.equal(cancelled, 3);

	slider.enabled = true; control.focusTarget.focus();
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	let sequence = 0;
	for (const key of ['Home', 'ArrowRight', 'End', 'ArrowLeft']) for (const down of [true, false]) {
		input.inputButton('keyboard:0', key, down, down ? 1 : 0, clock.now(), ++sequence);
		clock.advance(20); input.pollInput(); focus.handleKeyboard(input.getPlayerInput(1));
	}
	assert.deepEqual(values.slice(-4), [0, 1, 2000, 1999]);
});
