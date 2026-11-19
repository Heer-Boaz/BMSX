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

test('split intent changes notify session consumers, while constrained layout retains the same intent', () => {
	const view = new WorkbenchSplitView(0.4), ratios: number[] = [];
	const unsubscribe = view.onDidChangeRatio(() => ratios.push(view.ratio));
	view.minimumFirstSize = 200; view.minimumSecondSize = 100;
	view.layout(0, 0, 600, 200);
	view.ratio = 0.2;
	view.ratio = 0.2;
	view.layout(0, 0, 1000, 200);
	assert.deepEqual(ratios, [0.2]);
	view.resize(0.5);
	assert.deepEqual(ratios, [0.2, 0.5]);
	unsubscribe(); view.ratio = 0.7;
	assert.deepEqual(ratios, [0.2, 0.5]);
});

test('coordinated ratio publication remains distinct from actual native sash resizing', () => {
	const view = new WorkbenchSplitView(0.4), ratios: number[] = [], sizes: number[] = [];
	const releaseRatio = view.onDidChangeRatio(() => ratios.push(view.ratio));
	const releaseResize = view.onDidResize(() => sizes.push(view.ratio));
	view.layout(0, 0, 800, 300);
	view.ratio = 0.6;
	assert.deepEqual(ratios, [0.6]); assert.deepEqual(sizes, []);
	view.layout(0, 0, 1600, 300);
	assert.deepEqual(ratios, [0.6]); assert.deepEqual(sizes, []);
	view.moveTo(1120);
	assert.deepEqual(ratios, [0.6, 0.7]); assert.deepEqual(sizes, [0.7]);
	view.moveTo(view.position); view.resize(view.ratio);
	assert.deepEqual(ratios, [0.6, 0.7]); assert.deepEqual(sizes, [0.7]);
	view.reset();
	assert.deepEqual(ratios, [0.6, 0.7, 0.4]); assert.deepEqual(sizes, [0.7, 0.4]);
	releaseRatio(); releaseResize(); view.resize(0.5);
	assert.deepEqual(ratios, [0.6, 0.7, 0.4]); assert.deepEqual(sizes, [0.7, 0.4]);
});

for (const orientation of ['horizontal', 'vertical'] as const)
	for (const allocation of ['constrained', 'filled', 'unarranged'] as const)
		test(`${orientation} ${allocation} reset restores default ratio intent before future layout without clamping or duplicate publication`, () => {
			const view = new WorkbenchSplitView(0.4, orientation);
			view.minimumFirstSize = allocation === 'filled' ? 500 : 300; view.minimumSecondSize = 100;
			if (allocation !== 'unarranged') {
				if (orientation === 'horizontal') view.layout(37, 19, 637, 419);
				else view.layout(19, 37, 419, 637);
			}
			view.ratio = 0.8;
			const ratios: number[] = [], sizes: number[] = [];
			view.onDidChangeRatio(() => ratios.push(view.ratio)); view.onDidResize(() => sizes.push(view.ratio));
			assert.equal(view.canReset, true);
			view.reset();
			assert.equal(view.ratio, view.defaultRatio); assert.equal(view.canReset, false);
			assert.deepEqual(ratios, [0.4]); assert.deepEqual(sizes, [0.4]);
			const revision = view.revision;
			view.reset(); assert.equal(view.revision, revision);
			assert.deepEqual(ratios, [0.4]); assert.deepEqual(sizes, [0.4]);
			if (orientation === 'horizontal') view.layout(37, 19, 2037, 419);
			else view.layout(19, 37, 419, 2037);
			assert.equal(view.position, 837, 'growth projects the restored default, never the earlier constrained ratio');
			assert.equal(view.ratio, 0.4); assert.equal(view.revision, revision);
		});

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

test('native ratio resize reaches the same nearest raster position admitted by its query, including at child limits', () => {
	const view = new WorkbenchSplitView(0.35);
	view.minimumFirstSize = 138; view.minimumSecondSize = 308;
	view.layout(0, 20, 768, 400);
	view.moveTo(1000);
	assert.equal(view.position, 460);
	view.moveTo(-100);
	assert.equal(view.position, 138);
});

for (const orientation of ['horizontal', 'vertical'] as const) for (const start of [0, 37]) {
	test(`${orientation} ratio resize preserves exact native steps and round trips at origin ${start}`, () => {
		const view = new WorkbenchSplitView(0.5, orientation);
		if (orientation === 'horizontal') view.layout(start, 0, start + 211, 120);
		else view.layout(0, start, 120, start + 211);
		const original = view.position;
		assert.equal(original, start + Math.round(211 * 0.5));
		assert.equal(view.canMoveTo(original), false);
		for (let step = 0; step < 10; step++) {
			assert.equal(view.canMoveTo(original + 12.4), true);
			view.moveTo(original + 12.4);
			assert.equal(view.position, original + 12);
			assert.equal(view.canMoveTo(original + 12), false);
			assert.equal(view.canMoveTo(original), true);
			view.moveTo(original);
			assert.equal(view.position, original);
		}
	});
}

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

test('rebinding the same sash control to another arranged axis drains its old hold without withdrawing admitted keyboard focus', t => {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	const columns = new WorkbenchSplitView(0.4), rows = new WorkbenchSplitView(0.6, 'vertical');
	columns.layout(10, 20, 610, 420); rows.layout(10, 20, 610, 420);
	control.setInput(columns); control.focusTarget.focus();
	let blurred = false; const unbind = control.focusTarget.onDidBlur(() => { blurred = true; });
	t.after(() => { unbind(); control.dispose(); });
	const pointer: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
		viewportX: columns.position, viewportY: 60 };
	const scope = Symbol('physical sash'); capture.beginRoute(scope, pointer); control.handlePointer(pointer);
	assert.equal(capture.active, true);
	control.setInput(rows);
	assert.equal(capture.active, false); assert.equal(capture.draining, true); assert.equal(blurred, false);
	assert.ok(focus.target === control.focusTarget);
	const columnRatio = columns.ratio, rowRatio = rows.ratio, key = new KeyInputEvent('ArrowDown', KeyModifier.none);
	focus.handleKeyboard(key); assert.equal(key.consumed, true); assert.ok(rows.ratio > rowRatio); assert.equal(columns.ratio, columnRatio);
	const wrongAxis = new KeyInputEvent('ArrowRight', KeyModifier.none); focus.handleKeyboard(wrongAxis); assert.equal(wrongAxis.consumed, false);
	capture.dispatch({ ...pointer, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 1, scope);
	assert.equal(capture.draining, false); assert.equal(columns.ratio, columnRatio);
});
