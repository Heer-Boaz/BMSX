import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchMainWorkspaceLayout, type WorkbenchMainWorkspaceState } from '../../ide/workbench/common/main_workspace_layout';
import { WorkbenchSplitControl } from '../../ide/workbench/ui/split_control';
import { WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';

// Positions and dimensions are the pure allocation/sash contract, not incidental UI assertions.
const HIERARCHY = { minimumWidth: 80, preferredWidth: 120, minimumHeight: 0 };
const DETAILS = { minimumWidth: 90, preferredWidth: 140, minimumHeight: 0 };
const ACTIVITY = { minimumWidth: 0, minimumHeight: 60, preferredHeight: 120 };

test('Main retains its full family while allocating the complete named row above a bottom activity', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 837, bottom: 519 };
	layout.activityVisible = true;
	const vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 0 };
	assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), true);
	assert.deepEqual(layout.bounds, bounds);
	assert.deepEqual(layout.rowBounds, { left: 37, top: 19, right: 837, bottom: 391 });
	assert.deepEqual(layout.activitySashBounds, { left: 37, top: 391, right: 837, bottom: 399 });
	assert.deepEqual(layout.activityBounds, { left: 37, top: 399, right: 837, bottom: 519 });
	assert.equal(layout.activitySash.position, 395);
	for (const region of [layout.hierarchyBounds, layout.documentBounds, layout.detailsBounds]) {
		assert.equal(region.top, layout.rowBounds.top); assert.equal(region.bottom, layout.rowBounds.bottom);
	}
	assert.equal(layout.activityHeight, undefined); assert.equal(layout.activityPresented, true);
	assert.equal(layout.contentHeight, 500); assert.equal(layout.scrollY, 0);
	assert.deepEqual(layout.verticalViewport, bounds);
	assert.equal(layout.verticalScrollTrack.left, layout.verticalScrollTrack.right);
	const row = layout.rowBounds, activity = layout.activityBounds;
	for (let frame = 0; frame < 1000; frame++) assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), false);
	assert.ok(layout.rowBounds === row && layout.activityBounds === activity);
});

test('passive activity contraction and later growth preserve requested pixels rather than a height ratio', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 20, right: 800, bottom: 520 };
	const vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 0 };
	layout.activityVisible = true; layout.activityHeight = 220;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 220);
	bounds.bottom = 220;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 92);
	assert.equal(layout.rowBounds.bottom - layout.rowBounds.top, 100);
	assert.equal(layout.activityHeight, 220);
	assert.equal(layout.activitySash.position, layout.activitySashBounds.top + WORKBENCH_SPLIT_SIZE / 2);
	bounds.bottom = 620;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 220);
	assert.equal(layout.activityBounds.bottom, bounds.bottom);
	assert.equal(layout.activityHeight, 220);
});

test('a constrained activity resize records the admitted side height without resizing it again during reflow', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 800, bottom: 200 };
	const vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 0 };
	layout.activityVisible = true; layout.activityHeight = 220;
	layout.hierarchyWidth = 160; layout.detailsWidth = 180;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	const position = layout.activitySash.position + 12;
	layout.activitySash.moveTo(position);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activitySash.position, position);
	assert.equal(layout.activityHeight, 80); assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 80);
	assert.equal(layout.hierarchyWidth, 160); assert.equal(layout.detailsWidth, 180);
});

test('activity visibility and consumer absence preserve the independent request without a phantom allocation', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 800, bottom: 500 };
	const vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 0 };
	layout.activityVisible = true; layout.activityHeight = 175;
	layout.layout(bounds, 200, undefined, undefined, 6, 0);
	assert.equal(layout.activityVisible, true); assert.equal(layout.activityPresented, false);
	assert.deepEqual(layout.rowBounds, bounds);
	assert.deepEqual(layout.activityBounds, { left: 0, top: 0, right: 0, bottom: 0 });
	assert.equal(layout.activitySash.resizable, false);
	layout.layout(bounds, 200, undefined, undefined, 6, 0, vertical);
	assert.equal(layout.activityPresented, true); assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 175);
	layout.activityVisible = false;
	layout.layout(bounds, 200, undefined, undefined, 6, 0, vertical);
	assert.equal(layout.activityPresented, false); assert.deepEqual(layout.rowBounds, bounds);
	assert.equal(layout.activitySash.resizable, false); assert.equal(layout.activityHeight, 175);
	layout.activityVisible = true;
	layout.layout(bounds, 200, undefined, undefined, 6, 0, { ...vertical, activity: undefined });
	assert.equal(layout.activityPresented, false); assert.equal(layout.activityHeight, 175);
	layout.layout(bounds, 200, undefined, undefined, 6, 0, vertical);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 175);
});

test('horizontal row overflow does not translate or widen the activity client', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 337, bottom: 519 };
	layout.activityVisible = true;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 1000, { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 0 });
	assert.equal(layout.contentWidth, 386); assert.equal(layout.scrollX, 86);
	assert.equal(layout.hierarchyBounds.left, bounds.left - 86); assert.equal(layout.detailsBounds.right, bounds.right);
	assert.equal(layout.activityBounds.left, bounds.left); assert.equal(layout.activityBounds.right, bounds.right);
	assert.equal(layout.scrollTrack.bottom, layout.activitySashBounds.top);
	assert.equal(layout.scrollTrack.bottom - layout.scrollTrack.top, 6);
	assert.equal(layout.activitySashBounds.bottom, layout.activityBounds.top);
	assert.equal(layout.contentHeight, 500);
});

for (const cause of ['horizontal-admits-vertical', 'vertical-admits-horizontal'] as const) {
	test(`${cause} preserves all readable minima and gives every overflow extent a real scrollbar track`, () => {
		const layout = new WorkbenchMainWorkspaceLayout();
		const bounds = { left: 0, top: 0, right: cause === 'horizontal-admits-vertical' ? 380 : 390,
			bottom: cause === 'horizontal-admits-vertical' ? 170 : 160 };
		const vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 1000 };
		layout.activityVisible = true; layout.activityHeight = 220;
		layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 1000, vertical);
		assert.deepEqual(layout.bounds, bounds); assert.equal(layout.contentHeight, 174);
		assert.equal(layout.verticalViewport.right, bounds.right - 6);
		assert.equal(layout.verticalScrollTrack.right - layout.verticalScrollTrack.left, 6);
		assert.equal(layout.scrollTrack.bottom - layout.scrollTrack.top, 6);
		assert.equal(layout.rowBounds.bottom - layout.rowBounds.top, 106);
		// Logical client minima survive scrolling; the physical row clip excludes its sticky scrollbar.
		assert.equal(layout.viewport.top, bounds.top);
		assert.equal(layout.viewport.bottom, layout.scrollTrack.top);
		assert.equal(layout.viewport.bottom - layout.viewport.top, 100 - layout.scrollY);
		assert.equal(layout.documentBounds.bottom - layout.documentBounds.top, 100);
		assert.equal(layout.documentBounds.right - layout.documentBounds.left, 200);
		assert.equal(layout.hierarchyBounds.right - layout.hierarchyBounds.left, 80);
		assert.equal(layout.detailsBounds.right - layout.detailsBounds.left, 90);
		assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 60);
		assert.equal(layout.scrollY, 174 - bounds.bottom);
		assert.equal(layout.rowBounds.top, -layout.scrollY);
		assert.equal(layout.activityBounds.bottom, bounds.bottom, 'the activity end is reachable through the vertical viewport');
		assert.equal(layout.activityBounds.left, 0); assert.equal(layout.activityBounds.right, bounds.right - 6);
		assert.equal(layout.activitySash.resizable, false);
		layout.activitySash.moveTo(1000); assert.equal(layout.activityHeight, 220);
		assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 1000, vertical), false);
	});
}

test('activity default measurement changes reflow once while explicit requests survive font-derived minima', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 800, bottom: 500 };
	const activity = { minimumWidth: 0, minimumHeight: 60, preferredHeight: 120 }, vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity, scrollY: 0 };
	layout.activityVisible = true;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	activity.preferredHeight = 160;
	assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), true);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 160);
	assert.equal(layout.activityHeight, undefined);
	layout.activityHeight = 80; activity.minimumHeight = 100;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 100); assert.equal(layout.activityHeight, 80);
	activity.minimumHeight = 60;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 80);
	vertical.rowMinimumHeight = 450;
	assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), true);
	assert.equal(layout.contentHeight, 518); assert.equal(layout.rowBounds.bottom - layout.rowBounds.top, 450);
});

test('activity placement publishes with both side regions before a reentrant newer activity intent', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), observed: WorkbenchMainWorkspaceState[] = [];
	layout.onDidChange(() => {
		observed.push({ hierarchyVisible: layout.hierarchyVisible, detailsVisible: layout.detailsVisible, activityVisible: layout.activityVisible, viewportRatio: layout.viewportSplit.ratio,
			hierarchyWidth: layout.hierarchyWidth, detailsWidth: layout.detailsWidth, activityHeight: layout.activityHeight });
		if (observed.length === 1) { layout.activityVisible = false; layout.activityHeight = 175; }
	});
	const state = { hierarchyVisible: false, detailsVisible: false, activityVisible: true, viewportRatio: 0.65,
		hierarchyWidth: 180, detailsWidth: 190, activityHeight: 220 };
	layout.setState(state);
	assert.deepEqual(observed[0], state);
	assert.equal(layout.activityVisible, false); assert.equal(layout.activityHeight, 175);
	assert.equal(layout.hierarchyVisible, false); assert.equal(layout.detailsVisible, false);
	assert.equal(observed.length, 3);
	layout.setState({ ...state, activityVisible: false, activityHeight: 175 });
	assert.equal(observed.length, 3);
});

test('the activity sash uses the actual shared vertical pointer and keyboard lifecycle', t => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 837, bottom: 519 };
	const vertical = { documents: true, rowMinimumHeight: 100, viewport: undefined, documentMinimumHeight: 100, activity: ACTIVITY, scrollY: 0 };
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(), control = new WorkbenchSplitControl(focus, capture, hover, parent);
	t.after(() => control.dispose());
	layout.activityVisible = true;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	control.setInput(layout.activitySash); parent.focus();
	let changes = 0; layout.onDidChange(() => changes++);
	const position = layout.activitySash.position;
	const pointer: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
		viewportX: 200, viewportY: position + 2 };
	assert.equal(control.handlePointer(pointer), true); assert.equal(capture.active, true); assert.ok(focus.target === parent);
	capture.dispatch({ ...pointer, justPressedButtons: 0, viewportY: position - 38 }, false, 1);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.activitySash.position, position - 40); assert.equal(layout.activityHeight, 160);
	assert.equal(changes, 1); assert.ok(focus.target === parent);
	focus.createTarget().focus(); assert.equal(capture.active, false);
	control.focusTarget.focus();
	const down = new KeyInputEvent('ArrowDown', KeyModifier.none); focus.handleKeyboard(down);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(down.consumed, true); assert.equal(layout.activityHeight, 135);
	assert.equal(layout.activitySash.position, position - 15);
	const reset = new KeyInputEvent('Home', KeyModifier.none); focus.handleKeyboard(reset);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(reset.consumed, true); assert.equal(layout.activityHeight, undefined);
	assert.equal(layout.activitySash.position, position); assert.equal(changes, 3);
});
