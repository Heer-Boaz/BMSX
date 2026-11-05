import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchViewportCamera } from '../../ide/workbench/ui/viewport_camera';
import { WorkbenchViewportNavigation, type WorkbenchViewportNavigationState } from '../../ide/workbench/ui/viewport_navigation';

const bounds = { left: 0, top: 0, right: 640, bottom: 480 };
function fixture(t: TestContext, mode: '2d' | '3d') {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), parent = focus.createTarget(), target = focus.createTarget(parent);
	const camera = new WorkbenchViewportCamera(); camera.setViewport(640, 480); camera.setMode(mode);
	const input: WorkbenchViewportNavigationState = { camera, navigationTool: 'select', navigationSpeed: 1 };
	let contexts = 0, changes = 0, now = 0;
	const control = new WorkbenchViewportNavigation(focus, capture, target, () => changes++, () => contexts++);
	target.bindKeyboard(event => control.handleKeyboard(event, now));
	control.setInput(input, bounds);
	t.after(() => control.dispose());
	const pointer: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: 200, viewportY: 200,
		pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	return { focus, capture, parent, target, input, camera, control, pointer, contexts: () => contexts, changes: () => changes,
		key(code: string, time: number, down = true, modifiers = KeyModifier.none) { now = time; const event = new KeyInputEvent(code, modifiers, false, down); focus.handleKeyboard(event); return event; } };
}

for (const mode of ['2d', '3d'] as const) test(`${mode} navigation disambiguates context clicks, jitter and a completed drag`, t => {
	const f = fixture(t, mode), before = f.camera.capture();
	assert.equal(f.control.handlePointer(f.pointer, 0), true); assert.equal(f.contexts(), 0);
	f.capture.dispatch({ ...f.pointer, viewportX: 202, justPressedButtons: 0 }, false, 10);
	assert.deepEqual(f.camera.capture(), before);
	f.capture.dispatch({ ...f.pointer, viewportX: 202, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Secondary }, false, 20);
	assert.equal(f.contexts(), 1); assert.equal(f.capture.active, false);
	f.control.handlePointer(f.pointer, 30);
	f.capture.dispatch({ ...f.pointer, viewportX: 220, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Secondary }, false, 40);
	assert.notDeepEqual(f.camera.capture(), before); assert.equal(f.contexts(), 1); assert.ok(f.changes() > 0);
});

test('both buttons zoom in 2D rather than selecting or panning content', t => {
	const f = fixture(t, '2d'); f.control.handlePointer(f.pointer, 0); const before = f.camera.capture();
	f.capture.dispatch({ ...f.pointer, viewportY: 230, pressedButtons: PointerButton.Primary | PointerButton.Secondary, justPressedButtons: PointerButton.Primary }, false, 20);
	const after = f.camera.capture(); assert.notEqual(after.canvas.scale, before.canvas.scale);
	assert.equal(after.canvas.centerX, before.canvas.centerX); assert.equal(after.canvas.centerY, before.canvas.centerY);
	f.capture.dispatch({ ...f.pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Secondary | PointerButton.Primary }, false, 30);
	assert.equal(f.contexts(), 0);
});

for (const retirement of ['input', 'mode', 'allocation', 'scope', 'native cancellation', 'blur'] as const) test(`flight stops on ${retirement}, including held-key and menu intent`, t => {
	const f = fixture(t, '3d'); f.control.handlePointer(f.pointer, 0); assert.equal(f.key('KeyW', 0).consumed, true);
	assert.equal(f.control.advance(10), true);
	if (retirement === 'input') f.control.clearInput();
	else if (retirement === 'mode') f.camera.setMode('2d');
	else if (retirement === 'allocation') f.control.layout({ ...bounds, right: 800 });
	else if (retirement === 'scope') f.target.scope.retireContext();
	else if (retirement === 'native cancellation') f.target.cancelInput();
	else f.parent.focus();
	const stopped = f.camera.capture(); assert.equal(f.control.advance(20), false); assert.equal(f.capture.active, false);
	assert.deepEqual(f.camera.capture(), stopped); assert.equal(f.contexts(), 0);
});

test('a captured fly gesture owns wheel speed beyond the viewport; release returns wheel to normal routing', t => {
	const f = fixture(t, '3d'); f.control.handlePointer(f.pointer, 0);
	const wheel = { valid: true, insideViewport: false, viewportX: 900, viewportY: 100, deltaX: 0, deltaY: -4, modifiers: KeyModifier.none };
	const before = f.camera.capture();
	assert.equal(f.capture.dispatchWheel(wheel, 0), true); assert.equal(f.input.navigationSpeed, 2);
	assert.deepEqual(f.camera.capture(), before, 'speed adjustment does not dolly the camera');
	f.capture.dispatch({ ...f.pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Secondary }, false, 10);
	assert.equal(f.contexts(), 0); assert.equal(f.capture.dispatchWheel(wheel, 20), false);
});

test('camera commands share focused dispatch, while held F in flight remains motion', t => {
	const f = fixture(t, '3d'), calls: string[] = [];
	for (const command of ['sceneViewport.frameAll', 'sceneViewport.frameSelection', 'sceneViewport.view2d', 'sceneViewport.view3d'] as const)
		f.target.registerCommand(command, { isEnabled: () => true, run: () => calls.push(command) });
	f.target.focus(); f.key('KeyF', 0); f.key('KeyF', 1, true, KeyModifier.shift); f.key('Digit2', 2); f.key('Digit3', 3);
	assert.deepEqual(calls, ['sceneViewport.frameSelection', 'sceneViewport.frameAll', 'sceneViewport.view2d', 'sceneViewport.view3d']);
	f.control.handlePointer(f.pointer, 10); const before = f.camera.capture(); f.key('KeyF', 10); f.control.advance(20);
	assert.equal(calls.length, 4); assert.notDeepEqual(f.camera.capture(), before);
});

test('source invalidation while admitting focus revokes the pending camera press, not the next press', t => {
	const f = fixture(t, '3d'); f.parent.focus();
	const unbind = f.parent.onDidBlur(() => { unbind(); f.control.cancel(); }); t.after(unbind);
	const before = f.camera.capture();
	assert.equal(f.control.handlePointer(f.pointer, 0), true); assert.equal(f.capture.active, false);
	assert.deepEqual(f.camera.capture(), before);
	assert.equal(f.control.handlePointer(f.pointer, 10), true); assert.equal(f.capture.active, true);
	f.capture.dispatch({ ...f.pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Secondary }, false, 20);
	assert.equal(f.contexts(), 1);
});
