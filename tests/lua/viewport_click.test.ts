import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../ide/common/constants';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchViewportClick } from '../../ide/workbench/ui/viewport_click';

const bounds = { left: 0, top: 0, right: 640, bottom: 480 };
function fixture(t: TestContext) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), parent = focus.createTarget(), target = focus.createTarget(parent);
	const clicks: PointerButton[] = [];
	const control = new WorkbenchViewportClick(focus, capture, target, (_x, _y, button) => {
		assert.equal(capture.active, false, 'click execution starts after the gesture releases ownership');
		clicks.push(button);
	});
	control.layout(bounds); t.after(() => control.dispose());
	const pointer: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: 200, viewportY: 200,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	const release = () => capture.dispatch({ ...pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 0);
	return { focus, capture, parent, target, clicks, control, pointer, release };
}

test('a viewport press focuses immediately, but a click commits only on physical release', t => {
	const f = fixture(t); f.parent.focus();
	f.control.begin(f.pointer, PointerButton.Primary);
	assert.ok(f.focus.admittedTarget === f.target); assert.equal(f.clicks.length, 0);
	f.capture.dispatch({ ...f.pointer, viewportX: 201, justPressedButtons: 0 }, false, 0);
	assert.equal(f.clicks.length, 0); assert.equal(f.release(), true);
	assert.deepEqual(f.clicks, [PointerButton.Primary]);
});

test('a coalesced down/up commits once, without retaining a capture', t => {
	const f = fixture(t);
	f.control.begin({ ...f.pointer, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, PointerButton.Primary);
	assert.equal(f.capture.active, false); assert.deepEqual(f.clicks, [PointerButton.Primary]);
	assert.equal(f.release(), false);
});

for (const interruption of ['drag', 'leave', 'chord', 'lost button', 'scope', 'allocation', 'blur', 'native cancellation', 'retirement'] as const) {
	test(`a viewport ${interruption} cancels its pending click, without clearing selection or deferring it`, t => {
		const f = fixture(t); f.control.begin(f.pointer, PointerButton.Primary);
		const held = { ...f.pointer, justPressedButtons: 0 };
		if (interruption === 'drag') f.capture.dispatch({ ...held, viewportX: held.viewportX + POINTER_DRAG_ACTIVATION_THRESHOLD }, false, 0);
		else if (interruption === 'leave') f.capture.dispatch({ ...held, viewportX: bounds.right }, false, 0);
		else if (interruption === 'chord') f.capture.dispatch({ ...held, pressedButtons: PointerButton.Primary | PointerButton.Secondary }, false, 0);
		else if (interruption === 'lost button') f.capture.dispatch({ ...held, pressedButtons: 0 }, false, 0);
		else if (interruption === 'scope') f.target.scope.retireContext();
		else if (interruption === 'allocation') f.control.layout({ ...bounds, right: 800 });
		else if (interruption === 'blur') f.parent.focus();
		else if (interruption === 'native cancellation') f.target.cancelInput();
		else f.control.cancel();
		f.capture.dispatch(held, false, 0); f.release();
		assert.equal(f.clicks.length, 0); assert.equal(f.capture.active, false);
		f.control.begin(f.pointer, PointerButton.Primary); f.release();
		assert.deepEqual(f.clicks, [PointerButton.Primary], 'only a fresh press can commit');
	});
}

test('layout retirement during focus admission cancels the old press', t => {
	const f = fixture(t); f.parent.focus();
	const unbind = f.parent.onDidBlur(() => { unbind(); f.control.layout({ ...bounds, right: 800 }); }); t.after(unbind);
	f.control.begin(f.pointer, PointerButton.Primary); f.release();
	assert.equal(f.clicks.length, 0); assert.equal(f.capture.active, false);
	f.control.begin(f.pointer, PointerButton.Primary); f.release();
	assert.deepEqual(f.clicks, [PointerButton.Primary]);
});

test('capture handoff cannot resurrect a click when the departing control retires its viewport', t => {
	const f = fixture(t); f.target.focus();
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { f.control.cancel(); } });
	f.control.begin(f.pointer, PointerButton.Primary); f.release();
	assert.equal(f.clicks.length, 0); assert.equal(f.capture.active, false);
});

test('secondary clicks use the same release and cancellation contract', t => {
	const f = fixture(t), pointer = { ...f.pointer, pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary };
	f.control.begin(pointer, PointerButton.Secondary); assert.equal(f.clicks.length, 0);
	f.capture.dispatch({ ...pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Secondary }, false, 0);
	assert.deepEqual(f.clicks, [PointerButton.Secondary]);
});
