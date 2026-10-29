import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchSplitControl } from '../../ide/workbench/ui/split_control';
import { WorkbenchFixedEdgeSplitView, WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';

// Widths and sash positions here are the shared geometry/input primitive's contract.
test('fixed-edge sizing preserves requested pixels through host and minimum changes, with a producer-owned default', () => {
	const view = new WorkbenchFixedEdgeSplitView('start');
	view.preferredSize = 120; view.minimumFirstSize = 84; view.minimumSecondSize = 204;
	view.layout(100, 20, 700, 200);
	assert.equal(view.position, 224); assert.equal(view.requestedSize, undefined);
	let changes = 0; view.onDidResize(() => changes++);
	view.moveTo(324); assert.equal(view.requestedSize, 220); assert.equal(changes, 1);
	view.layout(100, 20, 1000, 200); assert.equal(view.position, 324); assert.equal(changes, 1);
	view.minimumFirstSize = 404;
	assert.equal(view.position, 504); assert.equal(view.requestedSize, 220); assert.equal(changes, 1);
	view.reset(); assert.equal(view.requestedSize, undefined); assert.equal(view.position, 504); assert.equal(changes, 2);
	view.preferredSize = 150; view.minimumFirstSize = 84;
	assert.equal(view.position, 254); assert.equal(changes, 2, 'font/constraint projection is not a user resize');
});

test('the end-anchored sash retains its side width rather than its absolute position or a host-width ratio', () => {
	const view = new WorkbenchFixedEdgeSplitView('end');
	view.preferredSize = 140; view.minimumFirstSize = 204; view.minimumSecondSize = 94;
	view.layout(100, 20, 900, 200); assert.equal(view.position, 756);
	view.layout(100, 20, 1200, 200); assert.equal(view.position, 1056);
	view.moveTo(980); assert.equal(view.requestedSize, 216);
	view.layout(200, 20, 1500, 200); assert.equal(view.position, 1280);
	view.requestedSize = -100; assert.equal(view.position, 1406); assert.equal(view.requestedSize, -100);
	view.requestedSize = 10000; assert.equal(view.position, 404); assert.equal(view.requestedSize, 10000);
});

for (const edge of ['start', 'end'] as const) test(`the shared ${edge}-edge sash uses ordinary capture, keyboard resizing and default reset without moving editor focus on drag`, t => {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	const view = new WorkbenchFixedEdgeSplitView(edge);
	view.preferredSize = 160; view.minimumFirstSize = 84; view.minimumSecondSize = 24;
	view.layout(100, 20, 1100, 220); control.setInput(view);
	t.after(() => control.dispose());
	parent.focus();
	const position = view.position;
	const pointer: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
		viewportX: position + 2, viewportY: 40 };
	assert.equal(control.handlePointer(pointer), true); assert.equal(capture.active, true);
	assert.ok(focus.target === parent);
	capture.dispatch({ ...pointer, justPressedButtons: 0, viewportX: position + 52 }, false, 1);
	assert.equal(view.position, position + 50, 'the native shared gesture preserves its grip offset');
	assert.equal(view.requestedSize, edge === 'start' ? 210 : 110);
	assert.ok(focus.target === parent);
	focus.createTarget().focus(); assert.equal(capture.active, false);
	control.focusTarget.focus();
	const right = new KeyInputEvent('ArrowRight', KeyModifier.none);
	focus.handleKeyboard(right);
	assert.equal(right.consumed, true); assert.equal(view.position, position + 100);
	assert.equal(view.requestedSize, edge === 'start' ? 260 : 60);
	const reset = new KeyInputEvent('Home', KeyModifier.none); focus.handleKeyboard(reset);
	assert.equal(reset.consumed, true); assert.equal(view.requestedSize, undefined); assert.equal(view.position, position);
});

test('an exactly constrained fixed-edge sash has no resize admission and preserves its requested intent', t => {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	const view = new WorkbenchFixedEdgeSplitView('start');
	view.minimumFirstSize = 80 + WORKBENCH_SPLIT_SIZE / 2;
	view.minimumSecondSize = 200 + WORKBENCH_SPLIT_SIZE / 2;
	view.requestedSize = 300; view.layout(37, 19, 37 + 288, 219);
	control.setInput(view); parent.focus(); t.after(() => control.dispose());
	assert.equal(view.resizable, false); assert.equal(control.focusTarget.focus(), false); assert.ok(focus.target === parent);
	view.moveTo(50); assert.equal(view.requestedSize, 300);
	assert.equal(view.position, 37 + 84);
});
