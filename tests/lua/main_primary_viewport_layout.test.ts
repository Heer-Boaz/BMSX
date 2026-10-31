import assert from 'node:assert/strict';
import test from 'node:test';
import { point_in_rect } from '../../machine/ts/common/rect';
import type { WorkbenchViewSizeConstraints } from '../../ide/workbench/common/layout';
import { WorkbenchMainWorkspaceLayout, type WorkbenchMainWorkspaceState, type WorkbenchMainWorkspaceVerticalConstraints } from '../../ide/workbench/common/main_workspace_layout';
import { WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';

// Geometry is the focused allocation algorithm's contract: neither central client
// may cover the other or lose its readable minimum when the family overflows.
const HIERARCHY = { minimumWidth: 80, preferredWidth: 120, minimumHeight: 0 };
const DETAILS = { minimumWidth: 90, preferredWidth: 140, minimumHeight: 0 };
const VIEWPORT = { minimumWidth: 240, preferredWidth: 480, minimumHeight: 180 };
const ACTIVITY = { minimumWidth: 0, minimumHeight: 60, preferredHeight: 120 };

test('Main gives authored content its own central allocation above ordinary documents', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 1037, bottom: 819 };
	const vertical = { rowMinimumHeight: 140, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 0 };
	assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), true);
	assert.equal(layout.viewportPresented, true); assert.equal(layout.viewportSplit.orientation, 'vertical');
	assert.equal(layout.viewportSplit.ratio, 0.65);
	assert.deepEqual(layout.viewportBounds, { left: 165, top: 19, right: 889, bottom: 535 });
	assert.deepEqual(layout.viewportSashBounds, { left: 165, top: 535, right: 889, bottom: 543 });
	assert.deepEqual(layout.documentBounds, { left: 165, top: 543, right: 889, bottom: 819 });
	assert.deepEqual(layout.viewportClip, layout.viewportBounds);
	assert.deepEqual(layout.documentClip, layout.documentBounds);
	assert.equal(point_in_rect(200, 535, layout.viewportClip), false, 'the authored client clip excludes its sash');
	assert.equal(point_in_rect(200, 543, layout.viewportClip), false, 'the authored client clip excludes document content');
	assert.equal(point_in_rect(200, 534, layout.documentClip), false, 'the document host clip excludes authored content');
	assert.equal(layout.viewportSplit.position, 539);
	assert.equal(layout.hierarchyBounds.top, bounds.top); assert.equal(layout.hierarchyBounds.bottom, bounds.bottom);
	assert.equal(layout.detailsBounds.top, bounds.top); assert.equal(layout.detailsBounds.bottom, bounds.bottom);
	assert.equal(layout.contentHeight, 800); assert.equal(layout.contentWidth, 1000);
	const viewport = layout.viewportBounds, documents = layout.documentBounds, sash = layout.viewportSashBounds;
	const viewportClip = layout.viewportClip, documentClip = layout.documentClip;
	for (let frame = 0; frame < 1000; frame++) assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), false);
	assert.ok(layout.viewportBounds === viewport && layout.documentBounds === documents && layout.viewportSashBounds === sash);
	assert.ok(layout.viewportClip === viewportClip && layout.documentClip === documentClip);
});

test('unbound Main leaves the whole center to documents and retains the hidden viewport sizing intent', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 800, bottom: 500 };
	const vertical: WorkbenchMainWorkspaceVerticalConstraints = {
		rowMinimumHeight: 140, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 0,
	};
	layout.viewportSplit.ratio = 0.72;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, { ...vertical, viewport: undefined });
	assert.equal(layout.viewportPresented, false); assert.equal(layout.viewportSplit.resizable, false);
	assert.deepEqual(layout.viewportBounds, { left: 0, top: 0, right: 0, bottom: 0 });
	assert.deepEqual(layout.viewportClip, { left: 0, top: 0, right: 0, bottom: 0 });
	assert.deepEqual(layout.viewportSashBounds, { left: 0, top: 0, right: 0, bottom: 0 });
	assert.equal(layout.documentBounds.top, 0); assert.equal(layout.documentBounds.bottom, 500);
	assert.deepEqual(layout.documentClip, layout.documentBounds);
	assert.equal(layout.viewportSplit.ratio, 0.72);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.viewportPresented, true); assert.equal(layout.viewportSplit.position, 356);
});

for (const centralMinimum of ['viewport', 'documents'] as const) {
	test(`the ${centralMinimum} horizontal minimum protects both central clients`, () => {
		const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 537, bottom: 519 };
		const viewport = { ...VIEWPORT, minimumWidth: centralMinimum === 'viewport' ? 400 : 240 };
		const documentMinimumWidth = centralMinimum === 'documents' ? 400 : 200;
		const vertical = { rowMinimumHeight: 140, viewport, documentMinimumHeight: 140, activity: undefined, scrollY: 0 };
		layout.layout(bounds, documentMinimumWidth, HIERARCHY, DETAILS, 6, 1000, vertical);
		assert.equal(layout.contentWidth, 586); assert.equal(layout.scrollX, 86);
		assert.equal(layout.viewportBounds.right - layout.viewportBounds.left, 400);
		assert.equal(layout.documentBounds.right - layout.documentBounds.left, 400);
		assert.equal(layout.viewportBounds.left, layout.documentBounds.left);
		assert.equal(layout.viewportBounds.right, layout.documentBounds.right);
		assert.equal(layout.hierarchyBounds.left, bounds.left - 86); assert.equal(layout.detailsBounds.right, bounds.right);
		assert.equal(layout.hierarchySash.resizable, false); assert.equal(layout.detailsSash.resizable, false);
	});
}

for (const activity of [undefined, ACTIVITY]) {
	test(`central clips intersect each client with the visible row and physical viewport ${activity === undefined ? 'without' : 'with'} activity`, () => {
		const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 237, bottom: 119 };
		const vertical = { rowMinimumHeight: 100, viewport: VIEWPORT, documentMinimumHeight: 140, activity, scrollY: 0 };
		layout.activityVisible = activity !== undefined;
		for (const scrollY of [0, 100, 1000]) {
			for (const scrollX of [0, 1000]) {
				vertical.scrollY = scrollY;
				layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, scrollX, vertical);
				for (const [client, clip, sibling] of [
					[layout.viewportBounds, layout.viewportClip, layout.documentBounds],
					[layout.documentBounds, layout.documentClip, layout.viewportBounds],
				] as const) {
					const left = Math.max(client.left, layout.viewport.left, layout.verticalViewport.left);
					const top = Math.max(client.top, layout.viewport.top, layout.verticalViewport.top);
					assert.deepEqual(clip, { left, top,
						right: Math.max(left, Math.min(client.right, layout.viewport.right, layout.verticalViewport.right)),
						bottom: Math.max(top, Math.min(client.bottom, layout.viewport.bottom, layout.verticalViewport.bottom)) });
					assert.equal(point_in_rect((sibling.left + sibling.right) / 2, (sibling.top + sibling.bottom) / 2, clip), false);
				}
				if (scrollY === 0) {
					assert.equal(layout.documentClip.top, layout.documentClip.bottom, 'documents below the physical viewport have an empty clip');
					assert.equal(layout.viewportClip.top, bounds.top);
				} else if (scrollY === 1000) {
					assert.equal(layout.viewportClip.top, layout.viewportClip.bottom, 'authored content above the physical viewport has an empty clip');
					assert.equal(layout.documentClip.bottom, layout.viewport.bottom);
				}
				assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, scrollX, vertical), false);
			}
		}
	});
}

test('a horizontally offscreen central column has empty clips until its retained allocation is revealed', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 87, bottom: 519 };
	const vertical = { rowMinimumHeight: 100, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 0 };
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	for (const clip of [layout.viewportClip, layout.documentClip]) assert.equal(clip.left, clip.right);
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 150, vertical);
	for (const clip of [layout.viewportClip, layout.documentClip]) {
		assert.equal(clip.left, bounds.left); assert.equal(clip.right, bounds.right);
		assert.equal(clip.right > clip.left && clip.bottom > clip.top, true);
	}
});

for (const activity of [undefined, ACTIVITY, { minimumWidth: 0, minimumHeight: 150, preferredHeight: 180 }]) {
	test(`the horizontal scrollbar stays in visible row chrome with ${activity === undefined ? 'no' : activity.minimumHeight === 60 ? 'short' : 'tall'} activity`, () => {
		const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 237, bottom: 119 };
		const vertical = { rowMinimumHeight: 100, viewport: VIEWPORT, documentMinimumHeight: 140, activity, scrollY: 0 };
		layout.activityVisible = activity !== undefined;
		for (const scrollY of [0, 100, 1000]) {
			vertical.scrollY = scrollY;
			layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
			assert.equal(layout.rowBounds.bottom - layout.rowBounds.top, 334);
			assert.equal(layout.viewportBounds.bottom - layout.viewportBounds.top, 180);
			assert.equal(layout.documentBounds.bottom - layout.documentBounds.top, 140);
			assert.equal(layout.rowBounds.top, bounds.top - layout.scrollY);
			const visibleBottom = Math.max(bounds.top, Math.min(layout.rowBounds.bottom, bounds.bottom));
			assert.deepEqual(layout.scrollTrack, { left: bounds.left, top: Math.max(bounds.top, visibleBottom - 6),
				right: bounds.right - 6, bottom: visibleBottom });
			assert.deepEqual(layout.viewport, { left: bounds.left, top: bounds.top, right: bounds.right - 6, bottom: layout.scrollTrack.top });
			assert.equal(layout.viewport.top >= layout.verticalViewport.top && layout.scrollTrack.bottom <= layout.verticalViewport.bottom, true);
			if (layout.rowBounds.bottom > bounds.top) {
				assert.equal(layout.scrollTrack.bottom > layout.scrollTrack.top, true, 'every visible row exposes its horizontal scroll route');
				assert.equal(layout.viewportClip.bottom <= layout.scrollTrack.top, true);
				assert.equal(layout.documentClip.bottom <= layout.scrollTrack.top || layout.documentClip.top === layout.documentClip.bottom, true);
				if (activity !== undefined) assert.equal(layout.scrollTrack.bottom <= layout.activitySashBounds.top, true);
			} else {
				assert.equal(layout.viewport.top, layout.viewport.bottom);
				assert.equal(layout.scrollTrack.top, layout.scrollTrack.bottom);
				assert.equal(layout.viewportClip.top, layout.viewportClip.bottom);
				assert.equal(layout.documentClip.top, layout.documentClip.bottom);
			}
			assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), false);
		}
	});
}

test('visible row clipping does not reserve horizontal chrome when only the vertical axis overflows', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 837, bottom: 119 };
	const vertical = { rowMinimumHeight: 100, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 0 };
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.viewportBounds.bottom - layout.viewportBounds.top, 180);
	assert.equal(layout.documentBounds.bottom - layout.documentBounds.top, 140);
	assert.deepEqual(layout.viewport, layout.verticalViewport);
	assert.equal(layout.scrollTrack.top, bounds.bottom); assert.equal(layout.scrollTrack.bottom, bounds.bottom);
	assert.equal(layout.viewportClip.bottom, bounds.bottom);
});

test('vertical constraints preserve the requested viewport ratio and recover it after passive contraction', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 20, right: 800, bottom: 1020 };
	const vertical = { rowMinimumHeight: 140, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 0 };
	layout.viewportSplit.ratio = 0.9;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.viewportBounds.bottom - layout.viewportBounds.top, 852);
	assert.equal(layout.documentBounds.bottom - layout.documentBounds.top, 140);
	bounds.bottom = 220;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.contentHeight, 328); assert.equal(layout.viewportSplit.resizable, false);
	assert.equal(layout.viewportBounds.bottom - layout.viewportBounds.top, 180);
	assert.equal(layout.documentBounds.bottom - layout.documentBounds.top, 140);
	layout.viewportSplit.moveTo(1000);
	assert.equal(layout.viewportSplit.ratio, 0.9);
	bounds.bottom = 1020;
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.viewportBounds.bottom - layout.viewportBounds.top, 852);
	assert.equal(layout.viewportSplit.ratio, 0.9);
});

test('the complete row minimum still overflows vertically without activity', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 837, bottom: 319 };
	const vertical = { rowMinimumHeight: 600, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 1000 };
	layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	assert.equal(layout.contentHeight, 600); assert.equal(layout.scrollY, 300);
	assert.equal(layout.rowBounds.bottom - layout.rowBounds.top, 600);
	assert.equal(layout.verticalScrollTrack.right - layout.verticalScrollTrack.left, 6);
	assert.equal(layout.documentBounds.bottom, bounds.bottom);
	assert.equal(layout.activityPresented, false); assert.equal(layout.activitySash.resizable, false);
	assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical), false);
});

for (const activity of [undefined, ACTIVITY]) {
	for (const cause of ['horizontal-admits-vertical', 'vertical-admits-horizontal'] as const) {
		test(`central overflow ${cause} preserves both clients ${activity === undefined ? 'without' : 'with'} activity`, () => {
			const layout = new WorkbenchMainWorkspaceLayout(), minimumHeight = 328 + (activity === undefined ? 0 : 68);
			const bounds = { left: 37, top: 19, right: 37 + (cause === 'horizontal-admits-vertical' ? 420 : 430),
				bottom: 19 + minimumHeight + (cause === 'horizontal-admits-vertical' ? 2 : -2) };
			const vertical = { rowMinimumHeight: 100, viewport: VIEWPORT, documentMinimumHeight: 140, activity, scrollY: 1000 };
			layout.activityVisible = activity !== undefined;
			layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 1000, vertical);
			assert.equal(layout.contentWidth, 426); assert.equal(layout.contentHeight, minimumHeight + 6);
			assert.equal(layout.verticalScrollTrack.right - layout.verticalScrollTrack.left, 6);
			assert.equal(layout.scrollTrack.bottom - layout.scrollTrack.top, 6);
			assert.equal(layout.viewportBounds.bottom - layout.viewportBounds.top, 180);
			assert.equal(layout.documentBounds.bottom - layout.documentBounds.top, 140);
			assert.equal(layout.viewportBounds.right - layout.viewportBounds.left, 240);
			assert.equal(layout.documentBounds.right - layout.documentBounds.left, 240);
			assert.equal(layout.viewportSashBounds.bottom - layout.viewportSashBounds.top, WORKBENCH_SPLIT_SIZE);
			assert.equal(layout.viewportSplit.resizable, false);
			assert.equal(layout.hierarchyBounds.top, layout.viewportBounds.top);
			assert.equal(layout.detailsBounds.bottom, layout.documentBounds.bottom);
			assert.equal(layout.scrollY, layout.contentHeight - (bounds.bottom - bounds.top));
			if (activity !== undefined) {
				assert.equal(layout.activityBounds.bottom - layout.activityBounds.top, 60);
				assert.equal(layout.activityBounds.bottom, bounds.bottom);
				assert.equal(layout.activityBounds.left, bounds.left);
				assert.equal(layout.activityBounds.right, bounds.right - 6);
			} else assert.equal(layout.scrollTrack.bottom, bounds.bottom);
			assert.equal(layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 1000, vertical), false);
		});
	}
}

test('viewport measurements and split changes invalidate stable arrangement only once', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 800, bottom: 800 };
	const viewport: WorkbenchViewSizeConstraints = { ...VIEWPORT };
	const vertical = { rowMinimumHeight: 100, viewport, documentMinimumHeight: 140, activity: undefined, scrollY: 0 };
	const arrange = () => layout.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0, vertical);
	arrange(); assert.equal(arrange(), false);
	viewport.minimumWidth = 300; assert.equal(arrange(), true); assert.equal(arrange(), false);
	viewport.preferredWidth = 600; assert.equal(arrange(), true); assert.equal(arrange(), false);
	viewport.minimumHeight = 220; assert.equal(arrange(), true); assert.equal(arrange(), false);
	vertical.documentMinimumHeight = 180; assert.equal(arrange(), true); assert.equal(arrange(), false);
	layout.viewportSplit.ratio = 0.55;
	assert.equal(arrange(), true); assert.equal(layout.viewportSplit.position, 440); assert.equal(arrange(), false);
	let changes = 0;
	layout.onDidChange(() => changes++);
	layout.viewportSplit.moveTo(400);
	assert.equal(changes, 1); assert.equal(arrange(), true); assert.equal(arrange(), false);
	assert.equal(layout.viewportSplit.position, 400);
	layout.viewportSplit.reset();
	assert.equal(changes, 2); assert.equal(arrange(), true); assert.equal(arrange(), false);
	assert.equal(layout.viewportSplit.ratio, 0.65);
});

test('Main restores its viewport ratio in the same complete publication as side and activity placement', () => {
	const layout = new WorkbenchMainWorkspaceLayout(), observed: WorkbenchMainWorkspaceState[] = [];
	layout.layout({ left: 0, top: 0, right: 1000, bottom: 1000 }, 200, HIERARCHY, DETAILS, 6, 0,
		{ rowMinimumHeight: 100, viewport: VIEWPORT, documentMinimumHeight: 140, activity: undefined, scrollY: 0 });
	let nativeResizes = 0;
	layout.viewportSplit.onDidResize(() => nativeResizes++);
	layout.onDidChange(() => {
		observed.push({ hierarchyVisible: layout.hierarchyVisible, detailsVisible: layout.detailsVisible,
			activityVisible: layout.activityVisible, viewportRatio: layout.viewportSplit.ratio,
			hierarchyWidth: layout.hierarchyWidth, detailsWidth: layout.detailsWidth, activityHeight: layout.activityHeight });
		if (observed.length === 1) layout.viewportSplit.resize(0.4);
	});
	const state = { hierarchyVisible: false, detailsVisible: false, activityVisible: true, viewportRatio: 0.7,
		hierarchyWidth: 180, detailsWidth: 190, activityHeight: 220 };
	layout.setState(state);
	assert.deepEqual(observed[0], state);
	assert.equal(observed.length, 2); assert.equal(nativeResizes, 1);
	assert.equal(layout.viewportSplit.ratio, 0.4, 'the newer reentrant resize wins over the older restore');
	layout.setState({ ...state, viewportRatio: 0.4 }); assert.equal(observed.length, 2);
	layout.setState({ ...state, viewportRatio: 0.6 });
	assert.equal(observed.length, 3); assert.equal(layout.viewportSplit.ratio, 0.6);
	assert.equal(nativeResizes, 1, 'restoring a ratio does not manufacture a native sash gesture');
});
