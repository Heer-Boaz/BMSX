import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import type { RectBounds } from '../../machine/ts/common/rect';
import { createWorkbenchGraphEdge, createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import { GRAPH_FRAME_MARGIN, GRAPH_ZOOM_MIN, WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';

const font = new Font({ variant: 'tiny' });
function graph(bounds: RectBounds) {
	return createWorkbenchGraphModel(font, [], [createWorkbenchGraphEdge([
		bounds.left, bounds.top, bounds.right, bounds.bottom,
	])]);
}

function center(view: WorkbenchGraphViewport) {
	return [view.viewportToGraphX((view.bounds.left + view.bounds.right) / 2),
		view.viewportToGraphY((view.bounds.top + view.bounds.bottom) / 2)];
}

test('Fit frames the published layout extent, follows pane sizes and never enlarges content', () => {
	for (const bounds of [
		{ left: -400, top: -200, right: 600, bottom: 300 },
		{ left: -100, top: 0, right: 0, bottom: 300 },
		{ left: 0, top: -300, right: 600, bottom: 0 },
	]) {
		const view = new WorkbenchGraphViewport(graph(bounds));
		for (const width of [803, 403, 1203]) {
			view.layout(20, 30, 20 + width, 533);
			const expected = Math.min(1, (width - 3 - GRAPH_FRAME_MARGIN * 2) / (bounds.right - bounds.left),
				(500 - GRAPH_FRAME_MARGIN * 2) / (bounds.bottom - bounds.top));
			assert.equal(view.cameraMode, 'fit');
			assert.equal(view.zoom, expected);
			const actualCenter = center(view);
			assert.ok(Math.abs(actualCenter[0] - (bounds.left + bounds.right) / 2) < 1e-10);
			assert.ok(Math.abs(actualCenter[1] - (bounds.top + bounds.bottom) / 2) < 1e-10);
			assert.ok(view.graphToViewportX(bounds.left) >= view.bounds.left + GRAPH_FRAME_MARGIN);
			assert.ok(view.graphToViewportX(bounds.right) <= view.bounds.right - GRAPH_FRAME_MARGIN);
			assert.ok(view.graphToViewportY(bounds.top) >= view.bounds.top + GRAPH_FRAME_MARGIN);
			assert.ok(view.graphToViewportY(bounds.bottom) <= view.bounds.bottom - GRAPH_FRAME_MARGIN);
		}
	}
});

test('Fit saturates at the supported minimum rather than claiming every graph can fit', () => {
	const model = graph({ left: -10000, top: -10000, right: 10000, bottom: 10000 });
	const view = new WorkbenchGraphViewport(model);
	view.layout(0, 0, 303, 203);
	assert.equal(view.zoom, GRAPH_ZOOM_MIN);
	assert.deepEqual(center(view), [0, 0]);
	assert.ok(view.visibleBounds.right - view.visibleBounds.left < model.bounds.right - model.bounds.left);
	assert.equal(view.cameraMode, 'fit');
});

test('new geometry is fitted without changing selection or the published layout', () => {
	const view = new WorkbenchGraphViewport(graph({ left: 0, top: 0, right: 20, bottom: 20 }));
	view.layout(0, 0, 403, 303);
	const node = createWorkbenchGraphNode(font, 'selected', 300, 100);
	const model = createWorkbenchGraphModel(font, [node], [createWorkbenchGraphEdge([-100, -100, 900, 400])]);
	const geometry = JSON.stringify(model);
	view.setModel(model, node);
	assert.equal(view.cameraMode, 'fit');
	assert.equal(view.selection, node);
	assert.equal(view.zoom, (400 - GRAPH_FRAME_MARGIN * 2) / 1000);
	assert.equal(JSON.stringify(model), geometry);
	assert.equal(view.model, model);
});

test('manual pan and anchored zoom keep graph-space reading center through resize and translation', () => {
	const view = new WorkbenchGraphViewport(graph({ left: -1000, top: -1000, right: 1000, bottom: 1000 }));
	view.layout(10, 20, 813, 623);
	view.setZoom(2, 100, 120);
	view.pan(30, -40);
	const state = view.captureViewState();
	assert.equal(view.cameraMode, 'manual');
	for (const bounds of [
		[10, 20, 413, 323], [90, 100, 493, 403], [0, 0, 3, 3], [10, 20, 813, 623],
	]) {
		view.layout(bounds[0], bounds[1], bounds[2], bounds[3]);
		assert.deepEqual(center(view), [state.centerX, state.centerY]);
		assert.equal(view.zoom, state.scale);
	}
});

test('manual reading at a scroll limit survives shrinking without center clamping or drift', () => {
	const view = new WorkbenchGraphViewport(graph({ left: 0, top: 0, right: 40, bottom: 20 }));
	view.layout(0, 0, 803, 603);
	view.pan(-10000, -10000);
	const state = view.captureViewState();
	for (let repetition = 0; repetition < 20; repetition++) {
		view.layout(0, 0, 103, 83);
		assert.deepEqual(view.captureViewState(), state);
		view.layout(0, 0, 803, 603);
		assert.deepEqual(view.captureViewState(), state);
	}
});

test('explicit pending geometry revokes hits and selection but retains the admitted extent and camera', () => {
	for (const manual of [false, true]) {
		const node = createWorkbenchGraphNode(font, 'node', 400, 200);
		const model = createWorkbenchGraphModel(font, [node], [createWorkbenchGraphEdge([-100, -200, 900, 600])]);
		const view = new WorkbenchGraphViewport(model);
		view.layout(0, 0, 803, 603);
		view.selection = node;
		if (manual) { view.setZoom(2); view.pan(100, 80); }
		const before = view.captureViewState();
		view.setPendingModel(createWorkbenchGraphModel(font, [], []));
		assert.deepEqual(view.captureViewState(), before);
		assert.equal(view.selection, null);
		assert.equal(view.hitTest(100, 100), null);
		view.layout(20, 30, 423, 333);
		if (manual) assert.deepEqual(view.captureViewState(), before);
		else assert.equal(view.zoom, (300 - GRAPH_FRAME_MARGIN * 2) / 800);
		const pending = view.captureViewState();
		view.setModel(model, node);
		assert.deepEqual(view.captureViewState(), pending);
		assert.equal(view.selection, node);
	}
});

test('a genuinely empty admitted graph is distinct from a pending graph', () => {
	const view = new WorkbenchGraphViewport(graph({ left: -500, top: -200, right: 1000, bottom: 600 }));
	view.layout(0, 0, 403, 303);
	const empty = createWorkbenchGraphModel(font, [], []);
	const state = view.captureViewState();
	view.setPendingModel(empty);
	assert.deepEqual(view.captureViewState(), state);
	view.setModel(empty, null);
	assert.deepEqual(view.captureViewState(), { scale: 'fit', centerX: 0, centerY: 0 });
	assert.equal(view.zoom, 1);
});

test('typed camera state restores Fit intent or manual center independently of attachment size', () => {
	const model = graph({ left: -400, top: -200, right: 800, bottom: 400 });
	const original = new WorkbenchGraphViewport(model);
	original.layout(0, 0, 803, 603);
	const fit = original.captureViewState();
	original.setZoom(2); original.pan(110, 70);
	const manual = original.captureViewState();
	for (const state of [fit, manual]) {
		const restored = new WorkbenchGraphViewport(model);
		restored.restoreViewState(state);
		restored.layout(20, 30, 423, 333);
		assert.deepEqual(restored.captureViewState(), state);
		if (state.scale === 'fit') assert.equal(restored.zoom, (400 - GRAPH_FRAME_MARGIN * 2) / 1200);
		else assert.equal(restored.zoom, state.scale);
	}
});

test('local framing and native scrollbar movement express manual reading without selecting', () => {
	const node = createWorkbenchGraphNode(font, 'selected', 400, 200);
	const model = createWorkbenchGraphModel(font, [node], [createWorkbenchGraphEdge([-500, -300, 1000, 600])]);
	const view = new WorkbenchGraphViewport(model);
	view.layout(0, 0, 403, 303); view.selection = node;
	for (const operation of [
		() => { view.scrollX = view.scrollX; },
		() => view.setZoom(view.zoom), () => view.pan(1, 0),
		() => { view.beginManualNavigation(); view.horizontalScrollbar.setScroll(100); },
		() => view.frameBounds(node.bounds),
	]) {
		view.frameAll();
		operation();
		assert.equal(view.cameraMode, 'manual');
		assert.equal(view.selection, node);
		const state = view.captureViewState();
		view.layout(10, 20, 713, 523);
		assert.deepEqual(view.captureViewState(), state);
		view.layout(0, 0, 403, 303);
	}
	view.frameBounds({ left: 300, top: 200, right: 400, bottom: 300 });
	assert.deepEqual(center(view), [350, 250]);
	assert.equal(view.zoom, 1);
});

test('revealing fitted selection and zero pan retain Fit until a reveal physically changes the reading position', () => {
	const near = createWorkbenchGraphNode(font, 'near', 0, 0);
	const far = createWorkbenchGraphNode(font, 'far', 10000, 0);
	const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, [near], []));
	view.layout(0, 0, 403, 303); view.selection = near;
	const fitted = view.captureViewState();
	view.reveal(near); view.revealBounds(near.bounds); view.pan(0, 0);
	assert.equal(view.cameraMode, 'fit');
	assert.deepEqual(view.captureViewState(), fitted);
	assert.equal(view.selection, near);
	for (const region of [false, true]) {
		view.frameAll();
		view.setModel(createWorkbenchGraphModel(font, [near, far], []), near);
		assert.equal(view.cameraMode, 'fit');
		if (region) view.revealBounds(near.bounds);
		else view.reveal(near);
		assert.equal(view.cameraMode, 'manual');
		assert.equal(view.selection, near);
	}
});

test('only explicit proven selection correspondence follows a replaced layout anchor', () => {
	const first = createWorkbenchGraphNode(font, 'selected', -100, 50);
	const next = createWorkbenchGraphNode(font, 'selected', 300, 250);
	const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, [first], []));
	view.layout(20, 30, 823, 633); view.selection = first;
	view.setZoom(2); view.pan(50, 70);
	const point = [view.graphToViewportX(first.bounds.left), view.graphToViewportY(first.bounds.top)];
	view.setModel(createWorkbenchGraphModel(font, [next], []), next, 'selection');
	assert.deepEqual([view.graphToViewportX(next.bounds.left), view.graphToViewportY(next.bounds.top)], point);
	const state = view.captureViewState();
	view.setModel(createWorkbenchGraphModel(font, [], []), null);
	assert.deepEqual(view.captureViewState(), state);
	view.frameAll();
	view.setModel(createWorkbenchGraphModel(font, [first], []), first, 'selection');
	assert.equal(view.cameraMode, 'fit');
	assert.deepEqual(center(view), [(view.model.bounds.left + view.model.bounds.right) / 2,
		(view.model.bounds.top + view.model.bounds.bottom) / 2]);
});

test('unchanged layout retains transforms, visible bounds and scrollbar geometry without camera work', () => {
	const view = new WorkbenchGraphViewport(graph({ left: -200, top: -100, right: 300, bottom: 200 }));
	view.layout(0, 0, 403, 303);
	const transform = view.transform, visible = view.visibleBounds, thumb = view.horizontalScrollbar.getThumb();
	const horizontalRevision = view.horizontalScrollbar.revision, verticalRevision = view.verticalScrollbar.revision;
	const state = view.captureViewState();
	for (let frame = 0; frame < 100; frame++) {
		view.layout(0, 0, 403, 303);
		assert.equal(view.transform, transform);
		assert.equal(view.visibleBounds, visible);
		assert.equal(view.horizontalScrollbar.getThumb(), thumb);
	}
	assert.equal(view.horizontalScrollbar.revision, horizontalRevision);
	assert.equal(view.verticalScrollbar.revision, verticalRevision);
	assert.deepEqual(view.captureViewState(), state);
});
