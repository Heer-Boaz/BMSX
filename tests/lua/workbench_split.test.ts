import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchSplitControl } from '../../ide/workbench/ui/split_control';
import { WorkbenchSplitView } from '../../ide/workbench/ui/split_view';

test('shared pane sash captures drag, releases on blur/replacement and consumes only its focused keyboard input', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	const view = new WorkbenchSplitView(0.4);
	t.after(() => { control.dispose(); input.dispose(); });
	view.layout(100, 20, 1100, 600);
	control.setInput(view);
	parent.focus();
	const pointer: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, viewportX: view.position + 2, viewportY: 40 };
	assert.equal(control.handlePointer({ ...pointer, viewportX: 200 }), false);
	assert.equal(control.handlePointer(pointer), true);
	assert.equal(focus.target, parent, 'pointer resizing does not blur the active editor or commit its draft');
	assert.equal(capture.active, true);
	capture.dispatch({ ...pointer, justPressedButtons: 0, viewportX: 802 }, false, 1);
	assert.equal(view.position, 800, 'drag retains its initial grip offset');
	focus.createTarget().focus();
	assert.equal(capture.active, false);
	assert.equal(capture.dispatch({ ...pointer, viewportX: 1000 }, false, 2), false);
	assert.equal(view.position, 800, 'blur retires the gesture, rather than parking it');
	control.focusTarget.focus();
	input.inputButton('keyboard:0', 'ArrowLeft', true, 1, 1, 1);
	input.pollInput();
	const event = new KeyInputEvent('ArrowLeft', KeyModifier.none);
	focus.handleKeyboard(event);
	assert.ok(Math.abs(view.position - 750) <= 1);
	assert.equal(event.consumed, true);
	control.handlePointer({ ...pointer, viewportX: view.position });
	control.setInput(new WorkbenchSplitView(0.5));
	assert.equal(capture.active, false);
	assert.equal(control.focusTarget.hasFocus, false);
	const revision = view.revision;
	view.layout(0, 20, 500, 600);
	assert.equal(view.revision, revision, 'viewport layout does not change the retained split preference');
	view.resize(2);
	assert.equal(view.ratio, 1, 'the geometry owner uses actual child minima, not an arbitrary percentage');
	view.resize(view.defaultRatio);
	assert.equal(view.position, 200);
});

test('vertical split uses its height for drag, limits and focused keyboard resizing', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	const view = new WorkbenchSplitView(0.4, 'vertical');
	t.after(() => { control.dispose(); input.dispose(); });
	view.layout(150, 100, 300, 1100);
	control.setInput(view);
	parent.focus();
	const pointer: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, viewportX: 200, viewportY: view.position + 2 };
	assert.equal(control.handlePointer({ ...pointer, viewportX: 301 }), false);
	assert.equal(control.handlePointer(pointer), true);
	capture.dispatch({ ...pointer, justPressedButtons: 0, viewportY: 802 }, false, 1);
	assert.equal(view.position, 800);
	assert.equal(focus.target, parent, 'vertical pointer resizing retains its editor focus too');
	focus.createTarget().focus();
	assert.equal(capture.active, false);
	control.focusTarget.focus();
	input.inputButton('keyboard:0', 'ArrowUp', true, 1, 1, 1);
	input.pollInput();
	const event = new KeyInputEvent('ArrowUp', KeyModifier.none);
	focus.handleKeyboard(event);
	assert.ok(Math.abs(view.position - 750) <= 1);
	assert.equal(event.consumed, true);
	view.resize(view.defaultRatio);
	assert.equal(view.position, 500);
});

test('requested split intent survives constrained placement while user resizing still obeys client limits', () => {
	const view = new WorkbenchSplitView(0.4);
	view.minimumFirstSize = 300; view.minimumSecondSize = 100;
	view.layout(23, 31, 623, 431);
	view.ratio = 0.2;
	assert.equal(view.ratio, 0.2); assert.equal(view.position, 323);
	const revision = view.revision;
	view.ratio = 0.2; assert.equal(view.revision, revision, 'equal intent does not invalidate composition');
	view.layout(23, 31, 2023, 431);
	assert.equal(view.ratio, 0.2); assert.equal(view.position, 423); assert.equal(view.revision, revision);
	view.layout(23, 31, 623, 431);
	view.resize(0.2); assert.equal(view.ratio, 0.5); assert.equal(view.position, 323);
	view.resize(0.99); assert.equal(view.ratio, 1 - 100 / 600); assert.equal(view.position, 523);
});

test('unarranged or minimum-filled sashes cannot receive resize focus or capture', t => {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	const view = new WorkbenchSplitView(0.6);
	t.after(() => control.dispose());
	control.setInput(view); parent.focus();
	control.focusTarget.focus(); assert.equal(control.focusTarget.hasFocus, false);
	view.resize(0.2); assert.equal(view.ratio, 0.6, 'no arranged resize interval preserves requested intent');
	view.minimumFirstSize = 90; view.minimumSecondSize = 10; view.layout(0, 0, 100, 50);
	const pointer: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, viewportX: view.position, viewportY: 10 };
	assert.equal(view.resizable, false); assert.equal(control.handlePointer(pointer), false); assert.equal(capture.active, false);
	control.focusTarget.focus(); assert.equal(control.focusTarget.hasFocus, false);
	view.resize(0.9); assert.equal(view.ratio, 0.6);
	view.layout(0, 0, 110, 50); assert.equal(view.resizable, true);
	control.focusTarget.focus(); assert.equal(control.focusTarget.hasFocus, true);
	view.resize(0.99); assert.equal(view.ratio, 1 - 10 / 110);
	view.resize(0); assert.equal(view.ratio, 90 / 110);
});
