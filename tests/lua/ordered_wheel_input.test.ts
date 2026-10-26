import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { RemoteInput } from '../../hosts/common/input/remote';
import { KeyModifier } from '../../hosts/common/input/text';
import type { WheelInputEvent } from '../../hosts/common/input/pointer_event';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import type { CartEditor } from '../../ide/cart_editor';
import type { WheelInputSnapshot } from '../../ide/common/models';
import { handleEditorWheelInput, handleWorkbenchPaneWheel } from '../../ide/input/pointer/wheel';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WORKBENCH_POINTER_SCOPE } from '../../ide/input/pointer/capture';
import { inputFocus } from '../../ide/input/focus';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { getWorkbenchEditorBounds, refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { FrameBitmap } from '../../hosts/common/frame_bitmap';

test('remote wheel preserves ordering, fractions and source-time context before the next guest sample', t => {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const events: Array<WheelInputEvent & { pane: number }> = [];
	let pane = 0;
	const scroll = [0, 0];
	const remote = new RemoteInput(input, clock, undefined, event => {
		if (event.pressedButtons !== 0) pane = 1;
	}, event => {
		events.push({ ...event, pane });
		scroll[pane] += event.deltaY;
		assert.equal(input.getPlayerInput(1).pollFrame, 0);
		return false;
	});
	clock.advance(17);
	remote.apply([
		{ type: 'pointer', x: 120, y: 80 },
		{ type: 'key', code: 'ShiftRight', down: true },
		{ type: 'wheel', deltaY: 0.25 },
		{ type: 'key', code: 'ShiftRight', down: false },
		{ type: 'button', button: 'primary', down: true },
		{ type: 'pointer', x: 240, y: 160 },
		{ type: 'wheel', deltaY: 0.5 },
		{ type: 'key', code: 'ControlLeft', down: true },
		{ type: 'wheel', deltaY: -0.25 },
		{ type: 'key', code: 'ControlLeft', down: false },
	]);
	assert.deepEqual(events, [
		{ x: 120, y: 80, deltaX: 0, deltaY: 0.25, attachmentDeltaY: 0.25, modifiers: KeyModifier.shift, timestamp: 17, pane: 0 },
		{ x: 240, y: 160, deltaX: 0, deltaY: 0.5, attachmentDeltaY: 0.5, modifiers: KeyModifier.none, timestamp: 17, pane: 1 },
		{ x: 240, y: 160, deltaX: 0, deltaY: -0.25, attachmentDeltaY: -0.25, modifiers: KeyModifier.ctrl, timestamp: 17, pane: 1 },
	]);
	assert.deepEqual(scroll, [0.25, 0.25]);
	const snapshot = createInputControllerSnapshot();
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerWheelQ16, 0x8000);
	assert.equal(snapshot.pointerXQ16, 240 * 65536);
	assert.equal(snapshot.pointerYQ16, 160 * 65536);
	assert.equal(input.getPlayerInput(1).getRawButtonState('pointer_wheel', 'pointer').value, 0.5);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerWheelQ16, 0);
	assert.equal(events.length, 3);
	assert.deepEqual(scroll, [0.25, 0.25]);
});

test('public wheel router delivers each occurrence to its current pane using supplied geometry and modifiers', () => {
	inputFocus.setTarget(null);
	editorViewState.viewportWidth = 400;
	editorViewState.viewportHeight = 300;
	editorChromeState.menuBarHeight = 20;
	editorViewState.tabBarTotalHeight = 10;
	refreshWorkbenchLayout();
	const firstPane: WheelInputSnapshot[] = [], secondPane: WheelInputSnapshot[] = [];
	let activePane = { handleWheel: (event: WheelInputSnapshot) => firstPane.push(event) };
	// Only the routing dependencies are replaced; this is not a RuntimeCartEditor/UI fixture.
	const surfaces = new WorkbenchSurfaceService();
	const editor = { surfaces, editorGroup: { panes: { get activePane() { return activePane; } } } } as unknown as CartEditor;
	surfaces.attach({
		role: 'content', captureScope: WORKBENCH_POINTER_SCOPE, isVisible: () => true, draw() {},
		getBounds: getWorkbenchEditorBounds, getClip: getWorkbenchEditorBounds,
		handleWheel: event => handleWorkbenchPaneWheel(editor, event),
	});
	const first: WheelInputSnapshot = {
		viewportX: 100, viewportY: 100, valid: true, insideViewport: true,
		deltaX: 0.125, deltaY: 0.25, modifiers: KeyModifier.shift,
	};
	handleEditorWheelInput(editor, first, { x: 100, y: 100, ...first, attachmentDeltaY: 0.25, timestamp: 0 });
	activePane = { handleWheel: event => secondPane.push(event) };
	const second = { ...first, deltaX: -0.125, deltaY: -0.25, modifiers: KeyModifier.ctrl };
	handleEditorWheelInput(editor, second, { x: 100, y: 100, ...second, attachmentDeltaY: -0.25, timestamp: 0 });
	assert.deepEqual(firstPane, [first]);
	assert.deepEqual(secondPane, [second]);
	assert.equal(firstPane[0], first);
	assert.equal(secondPane[0], second);
	assert.equal(firstPane[0].modifiers, KeyModifier.shift);
	assert.equal(secondPane[0].modifiers, KeyModifier.ctrl);
	handleEditorWheelInput(editor, { ...first, viewportY: 5 }, { x: 100, y: 5, ...first, attachmentDeltaY: 0.25, timestamp: 0 });
	assert.equal(secondPane.length, 1, 'wheel over non-scrolling chrome does not reach the active editor');
});

test('wheel ownership follows exclusive UI surfaces and spatial guest hits, not keyboard focus', t => {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	editorViewState.viewportWidth = 400; editorViewState.viewportHeight = 300;
	refreshWorkbenchLayout();
	input.setPointerAdmissionMode('routed');
	const focusedGame = inputFocus.createTarget();
	const frames = new FrameBitmap();
	frames.publish(new Uint8Array(4), 1, 1, { presentationSequence: 0, cycles: 0, videoTick: 0 });
	focusedGame.guestInput = { bounds: { left: 250, top: 40, right: 390, bottom: 250 }, recipient: input,
		presentation: { kind: 'offscreen', frames } };
	focusedGame.focus();
	t.after(() => { inputFocus.setTarget(null); frames.dispose(); input.dispose(); });
	let sourceScroll = 0;
	const popup = { visible: false, handleWheel() {} };
	const surfaces = new WorkbenchSurfaceService();
	const extent = { left: 0, top: 0, right: 400, bottom: 300 };
	const editor = { surfaces,
		editorGroup: { panes: { activePane: { handleWheel: (event: WheelInputSnapshot) => { sourceScroll += event.deltaY; } } } },
	} as unknown as CartEditor;
	surfaces.attach({
		role: 'content', captureScope: WORKBENCH_POINTER_SCOPE, isVisible: () => true, draw() {},
		getBounds: getWorkbenchEditorBounds, getClip: getWorkbenchEditorBounds,
		handleWheel: event => handleWorkbenchPaneWheel(editor, event),
	});
	surfaces.attach({
		role: 'transient', outsidePress: 'consume', captureScope: Symbol('popup'),
		isVisible: () => popup.visible, getBounds: () => extent, getClip: () => extent, draw() {},
		handleWheel: () => { popup.handleWheel(); return true; },
	});
	const remote = new RemoteInput(input, clock, undefined, undefined, event => handleEditorWheelInput(editor, {
		viewportX: event.x, viewportY: event.y, valid: true, insideViewport: true,
		deltaX: event.deltaX, deltaY: event.deltaY, modifiers: event.modifiers,
	}, event));
	popup.visible = true;
	remote.apply([{ type: 'pointer', x: 100, y: 100 }, { type: 'wheel', deltaY: 2 }]);
	assert.equal(sourceScroll, 0);
	popup.visible = false;
	remote.apply([{ type: 'wheel', deltaY: 0.25 }]);
	assert.equal(sourceScroll, 0.25);
	assert.equal(inputFocus.target, focusedGame, 'scrolling another surface does not steal keyboard focus');
	remote.apply([{ type: 'pointer', x: 300, y: 100 }, { type: 'wheel', deltaY: 1 }]);
	assert.equal(sourceScroll, 0.25);
	input.pollInput();
	const snapshot = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerWheelQ16, 65536, 'only the guest-owned wheel occurrence reaches the machine');
	assert.equal(input.getPlayerInput(1).getRawButtonState('pointer_wheel', 'pointer').value, 3.25);
});
