import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { WorkbenchMainWorkspaceLayout, type WorkbenchMainWorkspaceState } from '../../ide/workbench/common/main_workspace_layout';
import type { WorkbenchViewSizeConstraints } from '../../ide/workbench/common/layout';
import { measureSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_layout';
import { measureSceneDetails } from '../../ide/workbench/contrib/scene_editor/details_layout';
import { WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';

// These rectangles and equality thresholds are the allocation algorithm's contract,
// not pixel assertions over an editor workflow.
const HIERARCHY = { minimumWidth: 80, preferredWidth: 120 };
const DETAILS = { minimumWidth: 90, preferredWidth: 140 };

test('Main allocates three real siblings and gives spare width to its permanent document client', () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 837, bottom: 219 };
	assert.equal(view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0), true);
	assert.deepEqual(view.hierarchyBounds, { left: 37, top: 19, right: 157, bottom: 219 });
	assert.deepEqual(view.documentBounds, { left: 165, top: 19, right: 689, bottom: 219 });
	assert.deepEqual(view.detailsBounds, { left: 697, top: 19, right: 837, bottom: 219 });
	assert.deepEqual(view.hierarchySashBounds, { left: 157, top: 19, right: 165, bottom: 219 });
	assert.deepEqual(view.detailsSashBounds, { left: 689, top: 19, right: 697, bottom: 219 });
	assert.equal(view.hierarchySash.position, 161); assert.equal(view.detailsSash.position, 693);
	assert.equal(view.hierarchyWidth, undefined); assert.equal(view.detailsWidth, undefined);
	assert.equal(view.scrollTrack.top, view.scrollTrack.bottom); assert.equal(view.contentWidth, 800);
	const hierarchy = view.hierarchyBounds, documents = view.documentBounds, details = view.detailsBounds;
	for (let frame = 0; frame < 1000; frame++) assert.equal(view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0), false);
	assert.ok(view.hierarchyBounds === hierarchy && view.documentBounds === documents && view.detailsBounds === details);
	bounds.right += 300; view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, 120);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, 140);
	assert.equal(view.documentBounds.right - view.documentBounds.left, 824);
});

test('constrained Main placement shrinks only displayed side widths and later restores the requested pixel widths', () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 13, right: 526, bottom: 213 };
	view.hierarchyWidth = 200; view.detailsWidth = 250;
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, 150);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, 160);
	assert.equal(view.documentBounds.right - view.documentBounds.left, 200);
	assert.equal(view.hierarchyWidth, 200); assert.equal(view.detailsWidth, 250);
	assert.equal(view.hierarchySash.position, view.hierarchySashBounds.left + WORKBENCH_SPLIT_SIZE / 2);
	assert.equal(view.detailsSash.position, view.detailsSashBounds.left + WORKBENCH_SPLIT_SIZE / 2);
	bounds.right = 1000; view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, 200);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, 250);
	assert.equal(view.documentBounds.right - view.documentBounds.left, 534);
	assert.equal(view.hierarchyWidth, 200); assert.equal(view.detailsWidth, 250);
});

for (const role of ['hierarchy', 'details'] as const) test(`constrained Main ${role} resizing stays at the admitted sash position through reflow`, () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 526, bottom: 200 };
	view.hierarchyWidth = 200; view.detailsWidth = 250;
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	const split = role === 'hierarchy' ? view.hierarchySash : view.detailsSash;
	const requested = split.position + (role === 'hierarchy' ? -34 : 34);
	const otherWidth = role === 'hierarchy' ? view.detailsWidth : view.hierarchyWidth;
	split.moveTo(requested);
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	assert.equal(split.position, requested, 'the allocator does not contract a legal user resize a second time');
	assert.equal(role === 'hierarchy' ? view.detailsWidth : view.hierarchyWidth, otherWidth, 'resizing one side does not rewrite the other requested size');
	assert.equal(view.documentBounds.right - view.documentBounds.left, 200);
	const effectiveWidth = role === 'hierarchy' ? view.hierarchyBounds.right - view.hierarchyBounds.left
		: view.detailsBounds.right - view.detailsBounds.left;
	assert.equal(role === 'hierarchy' ? view.hierarchyWidth : view.detailsWidth, effectiveWidth);
});

test('Main overflow preserves all actual minima and translates all three clients through one horizontal viewport', () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 37, top: 19, right: 337, bottom: 219 };
	view.hierarchyWidth = 200; view.detailsWidth = 250;
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 1000);
	assert.equal(view.contentWidth, 386); assert.equal(view.scrollX, 86);
	assert.deepEqual(view.viewport, { left: 37, top: 19, right: 337, bottom: 213 });
	assert.deepEqual(view.scrollTrack, { left: 37, top: 213, right: 337, bottom: 219 });
	assert.equal(view.hierarchyBounds.left, 37 - 86); assert.equal(view.detailsBounds.right, 337);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, 80);
	assert.equal(view.documentBounds.right - view.documentBounds.left, 200);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, 90);
	for (const split of [view.hierarchySash, view.detailsSash]) {
		assert.equal(split.resizable, false);
		assert.equal(split.end - split.start, split.minimumFirstSize + split.minimumSecondSize);
		split.moveTo(1000);
	}
	assert.equal(view.hierarchyWidth, 200); assert.equal(view.detailsWidth, 250);
	bounds.right = 837; view.layout(bounds, 200, HIERARCHY, DETAILS, 6, view.scrollX);
	assert.equal(view.scrollX, 0); assert.equal(view.hierarchyBounds.left, bounds.left);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, 200);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, 250);
});

for (const role of ['hierarchy', 'details'] as const) test(`Main ${role} visibility intent survives absence without rewriting its requested size`, () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 800, bottom: 200 };
	view.hierarchyWidth = 160; view.detailsWidth = 180;
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	const width = role === 'hierarchy' ? view.hierarchyWidth : view.detailsWidth;
	if (role === 'hierarchy') view.hierarchyVisible = false; else view.detailsVisible = false;
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	const region = role === 'hierarchy' ? view.hierarchyBounds : view.detailsBounds;
	const sash = role === 'hierarchy' ? view.hierarchySash : view.detailsSash;
	assert.deepEqual(region, { left: 0, top: 0, right: 0, bottom: 0 }); assert.equal(sash.resizable, false);
	assert.equal(view.documentBounds.right - view.documentBounds.left, role === 'hierarchy' ? 612 : 632);
	if (role === 'hierarchy') view.hierarchyVisible = true; else view.detailsVisible = true;
	view.layout(bounds, 200, role === 'hierarchy' ? undefined : HIERARCHY, role === 'details' ? undefined : DETAILS, 6, 0);
	assert.equal(role === 'hierarchy' ? view.hierarchyVisible : view.detailsVisible, true);
	assert.equal(role === 'hierarchy' ? view.hierarchyPresented : view.detailsPresented, false);
	assert.equal(role === 'hierarchy' ? view.hierarchyWidth : view.detailsWidth, width);
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	assert.equal(region.right - region.left, width);
	assert.equal(role === 'hierarchy' ? view.hierarchyPresented : view.detailsPresented, true);
});

test('Main default reading widths follow producer font metrics while explicit size requests remain independent', () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 1200, bottom: 200 };
	const hierarchy: WorkbenchViewSizeConstraints = { minimumWidth: 0, preferredWidth: 0 };
	const details: WorkbenchViewSizeConstraints = { minimumWidth: 0, preferredWidth: 0 };
	const tiny = new EditorFont('tiny'), msx = new EditorFont('msx');
	measureSceneHierarchy(tiny, hierarchy); measureSceneDetails(tiny, details);
	view.layout(bounds, 200, hierarchy, details, 6, 0);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, hierarchy.preferredWidth);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, details.preferredWidth);
	view.hierarchyWidth = hierarchy.minimumWidth + 1; view.detailsWidth = details.minimumWidth + 1;
	const requestedHierarchy = view.hierarchyWidth, requestedDetails = view.detailsWidth;
	measureSceneHierarchy(msx, hierarchy); measureSceneDetails(msx, details);
	view.layout(bounds, 200, hierarchy, details, 6, 0);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, hierarchy.minimumWidth);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, details.minimumWidth);
	assert.equal(view.hierarchyWidth, requestedHierarchy); assert.equal(view.detailsWidth, requestedDetails);
	measureSceneHierarchy(tiny, hierarchy); measureSceneDetails(tiny, details);
	view.layout(bounds, 200, hierarchy, details, 6, 0);
	assert.equal(view.hierarchyBounds.right - view.hierarchyBounds.left, requestedHierarchy);
	assert.equal(view.detailsBounds.right - view.detailsBounds.left, requestedDetails);
});

test('Main session observers receive requested visibility and width changes, never constrained placement writes', () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 300, bottom: 200 };
	let changes = 0; const unsubscribe = view.onDidChange(() => changes++);
	view.hierarchyWidth = 200; view.hierarchyWidth = 200; view.detailsWidth = 250;
	assert.equal(changes, 2);
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0); assert.equal(changes, 2);
	view.hierarchyVisible = false; view.hierarchyVisible = false;
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 100); assert.equal(changes, 3);
	view.detailsSash.reset(); assert.equal(changes, 4); assert.equal(view.detailsWidth, undefined);
	unsubscribe(); view.hierarchyVisible = true; assert.equal(changes, 4);
});

test('Main placement publishes a complete state before reentrant observers request a newer arrangement', () => {
	const view = new WorkbenchMainWorkspaceLayout(), observed: WorkbenchMainWorkspaceState[] = [];
	let redirected = false;
	view.onDidChange(() => {
		observed.push({ hierarchyVisible: view.hierarchyVisible, detailsVisible: view.detailsVisible,
			hierarchyWidth: view.hierarchyWidth, detailsWidth: view.detailsWidth });
		if (redirected) return;
		redirected = true; view.detailsVisible = true; view.detailsWidth = 175;
	});
	const state = { hierarchyVisible: false, detailsVisible: false, hierarchyWidth: 180, detailsWidth: 190 };
	view.setState(state);
	assert.deepEqual(observed[0], state, 'the first observer sees all four requested fields, not an intermediate restore');
	assert.equal(view.hierarchyVisible, false); assert.equal(view.hierarchyWidth, 180);
	assert.equal(view.detailsVisible, true); assert.equal(view.detailsWidth, 175);
	assert.equal(observed.length, 3);
	view.setState({ hierarchyVisible: false, detailsVisible: true, hierarchyWidth: 180, detailsWidth: 175 });
	assert.equal(observed.length, 3, 'an unchanged state does not publish another placement');
});

test('Main owns coordinated width publication while the fixed sash reports only native resize actions', () => {
	const view = new WorkbenchMainWorkspaceLayout(), bounds = { left: 0, top: 0, right: 1000, bottom: 200 };
	let changes = 0, resizes = 0;
	view.onDidChange(() => changes++);
	view.hierarchySash.onDidResize(() => resizes++); view.detailsSash.onDidResize(() => resizes++);
	view.setState({ hierarchyVisible: true, detailsVisible: true, hierarchyWidth: 160, detailsWidth: 180 });
	assert.equal(changes, 1); assert.equal(resizes, 0);
	view.layout(bounds, 200, HIERARCHY, DETAILS, 6, 0);
	view.hierarchySash.moveTo(view.hierarchySash.position + 20);
	assert.equal(changes, 2); assert.equal(resizes, 1);
	assert.equal(view.hierarchyWidth, 180); assert.equal(view.hierarchySash.requestedSize, view.hierarchyWidth);
	view.detailsWidth = 200;
	assert.equal(changes, 3); assert.equal(resizes, 1);
	assert.equal(view.detailsSash.requestedSize, view.detailsWidth);
});
