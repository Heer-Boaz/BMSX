import { PointerButton } from '../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { PolyRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import type { PointerSnapshot } from '../../ide/common/models';
import { api } from '../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../ide/workbench/render/graph';
import { createWorkbenchGraphDisc, createWorkbenchGraphEdge, createWorkbenchGraphLabel, createWorkbenchGraphModel, createWorkbenchGraphNode, type WorkbenchGraphModel } from '../../ide/workbench/ui/graph/model';
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN, WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';
import type { HostOverlayTransform } from '../../machine/ts/render/host_overlay/transform';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult as Result } from '../../ide/workbench/ui/graph/control';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const font = new Font({ variant: 'tiny' });
function fixture() {
	const a = createWorkbenchGraphNode(font, 'FIRST\nDETAIL', -10, -4);
	const b = createWorkbenchGraphNode(font, 'SECOND', 100, 70);
	const edge = createWorkbenchGraphEdge([-20, 45, 140, 45, 140, 75]);
	const model: WorkbenchGraphModel = createWorkbenchGraphModel(font, [a, b], [edge]);
	const view = new WorkbenchGraphViewport(model);
	view.layout(20, 20, 120, 100);
	return { view, a, b, edge, model };
}
function pointer(x: number, y: number, pressed = false): PointerSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: pressed ? PointerButton.Primary : 0, justPressedButtons: 0, justReleasedButtons: 0, valid: true, insideViewport: true };
}

test('disc symbols retain their actual pixel silhouette instead of routing to padded text bounds', () => {
	const disc = createWorkbenchGraphDisc(11, 20, 20);
	assert.ok(disc.appearance === 'disc');
	assert.equal(disc.headerHeight, 11);
	assert.deepEqual(disc.bounds, { left: 20, top: 20, right: 31, bottom: 31 });
	assert.deepEqual(disc.lines, []);
	assert.equal(disc.insets[5], 0, 'the route endpoint meets the disc at its horizontal diameter');
	assert.ok(disc.insets[0] > 0, 'the disc has curved corners, not a square or font replacement glyph');
	assert.deepEqual(disc.insets, [...disc.insets].reverse());
	const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, [disc], []));
	view.layout(0, 0, 100, 100);
	const { presenter, renderer, queue } = createHostOverlayFixture(100, 100);
	const insets = disc.insets;
	for (let index = 0; index < 2; index += 1) {
		renderer.beginFrame(presenter); api.beginFrame(renderer);
		drawWorkbenchGraph(view, null, false); renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		assert.ok(!frame.commandKinds.slice(0, frame.commandCount).includes(Host2DKind.Glyphs));
		assert.equal(disc.insets, insets, 'paint consumes retained geometry without a new raster');
	}
});

test('graph layout uses the rendering font and retains route bounds independent of viewport movement', () => {
	const { view, a, b, edge, model } = fixture();
	assert.equal(a.bounds.right - a.bounds.left, font.measure('DETAIL') + 8);
	assert.equal(a.bounds.bottom - a.bounds.top, font.lineHeight * 2 + 8);
	assert.deepEqual(edge.bounds, { left: -20, top: 45, right: 140, bottom: 75 });
	const geometry = JSON.stringify(model);
	view.pan(70, 50);
	view.layout(0, 0, 384, 288);
	view.selection = b;
	view.reveal(b);
	assert.equal(view.model, model);
	assert.equal(JSON.stringify(model), geometry);
});

test('graph hit testing clips all four viewport edges and uses reverse node paint order', () => {
	const { view, a, edge } = fixture();
	assert.equal(view.hitTest(20, 20), a, 'partially visible node is selectable');
	assert.equal(view.hitTest(19, 20), null);
	assert.equal(view.hitTest(20, 19), null);
	assert.equal(view.hitTest(120, 65), null);
	assert.equal(view.hitTest(20, 100), null);
	assert.equal(view.hitTest(21, 65), edge);
	assert.equal(view.hitTest(21, 68), edge, 'inclusive line hit radius');
	assert.equal(view.hitTest(21, 69), null);
	const top = createWorkbenchGraphNode(font, 'ON TOP', -10, -4);
	view.setModel(createWorkbenchGraphModel(font, [a, top], [edge]), null);
	assert.equal(view.hitTest(20, 20), top);
});

test('edge hit testing chooses the nearest retained segment, including zero-length routes', () => {
	const { view } = fixture();
	const first = createWorkbenchGraphEdge([0, 0, 80, 80]);
	const nearest = createWorkbenchGraphEdge([0, 3, 80, 83]);
	const point = createWorkbenchGraphEdge([50, 10, 50, 10]);
	view.setModel(createWorkbenchGraphModel(font, [], [first, nearest, point]), null);
	assert.equal(view.hitTest(60, 61), first);
	assert.equal(view.hitTest(60, 63), nearest);
	assert.equal(view.hitTest(70, 30), point);
	const top = createWorkbenchGraphEdge(first.points);
	view.setModel(createWorkbenchGraphModel(font, [], [first, top]), null);
	assert.equal(view.hitTest(60, 60), top, 'ties respect reverse paint order');
});

test('retained arrow geometry participates in bounds and hit testing in every direction', () => {
	for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) {
		const edge = createWorkbenchGraphEdge([50, 50, 50 + dx * 20, 50 + dy * 20, 50 + dx * 20, 50 + dy * 20], [], true);
		const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, [], [edge]));
		view.layout(0, 0, 100, 100);
		assert.equal(edge.arrow.length, 6);
		assert.deepEqual(edge.arrow.slice(2, 4), edge.points.slice(-2), 'arrow ends at the actual directed endpoint');
		assert.equal(view.hitTest(edge.arrow[0], edge.arrow[1]), edge, 'arrow wing outside the shaft hit radius is selectable');
		for (let index = 0; index < edge.arrow.length; index += 2) {
			assert.ok(edge.arrow[index] >= edge.bounds.left && edge.arrow[index] <= edge.bounds.right);
			assert.ok(edge.arrow[index + 1] >= edge.bounds.top && edge.arrow[index + 1] <= edge.bounds.bottom);
		}
	}
	const point = createWorkbenchGraphEdge([50, 50, 50, 50], [], true);
	assert.deepEqual(point.arrow, [], 'a point has no direction, not a fabricated arrow');
});

test('label hit order matches paint order; opaque headers take precedence over labels and routes', () => {
	const label = createWorkbenchGraphLabel(font, 'SAME\nLABEL');
	const first = createWorkbenchGraphEdge([0, 60, 100, 60], [label], true);
	const last = createWorkbenchGraphEdge([0, 70, 100, 70], [createWorkbenchGraphLabel(font, 'SAME\nLABEL')], true);
	const view = new WorkbenchGraphViewport<WorkbenchGraphModel>(createWorkbenchGraphModel(font, [], [first, last]));
	view.layout(0, 0, 100, 100);
	assert.equal(view.hitTest(1, 1), last);
	assert.equal(last.bounds.top, 0, 'label contributes to the culling/reveal extent');
	const node = createWorkbenchGraphNode(font, 'TITLE', 0, 0);
	node.bounds.bottom = 100;
	view.setModel(createWorkbenchGraphModel(font, [node], [first, last]), null);
	assert.equal(view.hitTest(1, 1), node);
	assert.equal(view.hitTest(1, 60), first, 'the container body is not a node hit');
	assert.equal(view.hitTest(1, 80), null);
});

test('a visible compound body does not emit its offscreen header glyphs', () => {
	const node = createWorkbenchGraphNode(font, 'OFFSCREEN TITLE', 0, 0);
	node.bounds.bottom = 200;
	const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, [node], []));
	view.layout(0, 0, 100, 100);
	view.scrollY = 60;
	const { presenter, renderer, queue } = createHostOverlayFixture(100, 100);
	renderer.beginFrame(presenter);
	api.beginFrame(renderer);
	drawWorkbenchGraph(view, null, false);
	renderer.endFrame();
	const frame = queue.consumeOverlayFrame();
	assert.ok(frame.commandCount > 0, 'body and viewport still draw');
	assert.ok(!frame.commandKinds.slice(0, frame.commandCount).includes(Host2DKind.Glyphs));
});

test('model publication indexes only actual containers and labelled edges without copying geometry', () => {
	const group = createWorkbenchGraphNode(font, 'GROUP', 0, 0);
	group.bounds.bottom = 200;
	const leaf = createWorkbenchGraphNode(font, 'LEAF', 10, 50);
	const labelled = createWorkbenchGraphEdge([0, 20, 50, 20], [createWorkbenchGraphLabel(font, 'PATH')], true);
	const plain = createWorkbenchGraphEdge([0, 30, 50, 30]);
	const nodes = [group, leaf];
	const edges = [plain, labelled];
	const model = createWorkbenchGraphModel(font, nodes, edges);
	assert.equal(model.nodes, nodes);
	assert.equal(model.edges, edges);
	assert.deepEqual(model.containers, [group]);
	assert.deepEqual(model.labelledEdges, [labelled]);
	assert.equal(model.labelledEdges[0].labels[0], labelled.labels[0]);
	const next = createWorkbenchGraphModel(font, [leaf], [plain]);
	assert.deepEqual(next.containers, []);
	assert.deepEqual(next.labelledEdges, []);
});

test('reveal minimally scrolls into view and aligns oversized subjects instead of shrinking the font', () => {
	const { view, b, edge } = fixture();
	view.reveal(b);
	assert.equal(view.scrollX, b.bounds.right - (view.bounds.right - view.bounds.left) + 6);
	assert.equal(view.scrollY, b.bounds.bottom - (view.bounds.bottom - view.bounds.top) + 6);
	const x = view.scrollX;
	const y = view.scrollY;
	view.reveal(b);
	assert.equal(view.scrollX, x);
	assert.equal(view.scrollY, y);
	view.reveal(edge);
	assert.equal(view.scrollX, -26);
});

test('roving graph selection visits retained nodes and edges in both directions, including edge-only and empty models', () => {
	const { view, a, b, edge, model } = fixture();
	for (const expected of [a, b, edge, edge]) {
		view.selectRelative(1);
		assert.equal(view.selection, expected);
	}
	for (const expected of [b, a, a]) {
		view.selectRelative(-1);
		assert.equal(view.selection, expected);
	}
	view.selection = null;
	view.selectRelative(-1);
	assert.equal(view.selection, edge);
	assert.equal(view.model, model, 'traversal does not rebuild geometry');
	view.setModel(createWorkbenchGraphModel(font, [], [edge]), null);
	view.selectRelative(1);
	assert.equal(view.selection, edge);
	view.setModel(createWorkbenchGraphModel(font, [], []), null);
	view.selectRelative(-1);
	view.selectRelative(1);
	assert.equal(view.selection, null);
});

test('only a physical press begins a pan; capture can leave the control but cannot cross blur or attachment', () => {
	const { view } = fixture();
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(focus, capture);
	control.setInput(view);
	control.handlePointer({ ...pointer(80, 95, true), justPressedButtons: 0 }, 0);
	control.handlePointer({ ...pointer(90, 95, true), justPressedButtons: 0 }, 1);
	assert.equal(view.scrollX, 0, 'held pointer entering a pane is not a press');
	control.handlePointer({ ...pointer(80, 95, true), justPressedButtons: PointerButton.Primary }, 2);
	assert.equal(focus.target, control.focusTarget);
	assert.equal(capture.dispatch(pointer(140, 110, true), false, 3), true);
	assert.deepEqual([view.scrollX, view.scrollY], [-60, -15]);
	focus.setTarget(null);
	control.handlePointer({ ...pointer(90, 90, true), justPressedButtons: 0 }, 4);
	assert.equal(view.scrollX, -60, 'blur cancels capture');
	control.clearInput();
	control.setInput(view);
	control.handlePointer({ ...pointer(80, 95, true), justPressedButtons: 0 }, 5);
	control.handlePointer({ ...pointer(90, 90, true), justPressedButtons: 0 }, 6);
	assert.equal(view.scrollX, -60, 'reattaching retains viewport, not gesture');
	control.dispose();
});

test('selection and activation use retained item identity, never coordinates reused by a new model', () => {
	const { view, a, model } = fixture();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(view);
	assert.equal(control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 0), Result.Selection);
	assert.equal(view.selection, a);
	control.handlePointer({ ...pointer(22, 22), justPressedButtons: 0 }, 1);
	assert.equal(control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 50), Result.Activate);
	control.handlePointer({ ...pointer(22, 22), justPressedButtons: 0 }, 51);
	control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 100);
	const replacement = createWorkbenchGraphNode(font, 'FIRST\nDETAIL', -10, -4);
	view.setModel(createWorkbenchGraphModel(model.font, [replacement], model.edges), null);
	control.handlePointer({ ...pointer(22, 22), justPressedButtons: 0 }, 101);
	assert.equal(control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 150), Result.Selection);
	assert.equal(view.selection, replacement);
	control.dispose();
});

test('model replacement cancels a pan; empty-space clicks and wheel are bounded to the control', () => {
	const { view, a, model } = fixture();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(view);
	view.selection = a;
	assert.equal(control.handlePointer({ ...pointer(10, 10, true), justPressedButtons: PointerButton.Primary }, 0), Result.Outside);
	assert.equal(view.selection, a);
	control.handlePointer({ ...pointer(80, 95, true), justPressedButtons: PointerButton.Primary }, 1);
	assert.equal(view.selection, null);
	view.setModel({ ...model }, null);
	assert.equal(capture.dispatch(pointer(100, 95, true), false, 2), true);
	assert.equal(view.scrollX, 0);
	assert.equal(control.handleWheel(pointer(120, 30), 0, 10), false);
	assert.equal(control.handleWheel(pointer(60, 60), 0, 10), true);
	assert.equal(view.scrollY, 10);
	control.dispose();
});

test('idle graph drawing retains geometry, glyph strings, clip storage and translated route buffers', () => {
	const { view, edge, model } = fixture();
	const { presenter, renderer, queue } = createHostOverlayFixture(160, 120);
	const sourcePoints = edge.points.slice();
	const draw = () => {
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		drawWorkbenchGraph(view, null, false);
		renderer.endFrame();
		return queue.consumeOverlayFrame();
	};
	const first = draw();
	const refs = first.commandRefs.slice(0, first.commandCount);
	const poly = refs[first.commandKinds.indexOf(Host2DKind.Poly)] as PolyRenderSubmission;
	const points = poly.points;
	draw(); // second publication buffer
	for (let frame = 0; frame < 50; frame += 1) {
		const current = draw();
		for (let index = 0; index < refs.length; index += 1) assert.equal(current.commandRefs[index], refs[index]);
		assert.equal(poly.points, points);
		draw();
	}
	assert.equal(view.model, model);
	assert.deepEqual(edge.points, sourcePoints);
	assert.notEqual(points, edge.points, 'published translated points do not alias retained model geometry');
	assert.deepEqual(points, sourcePoints, 'layout coordinates stay local to their published transform');
	const transform = refs[first.commandKinds.indexOf(Host2DKind.Transform)] as HostOverlayTransform;
	assert.deepEqual(transform, { scale: 1, offsetX: 20, offsetY: 20 });
});

test('zoom preserves the inverse pointer anchor, selection and layout while scaling scroll extents and reveal', () => {
	const { view, model, b } = fixture();
	view.selection = b;
	const geometry = JSON.stringify(model);
	const x = view.viewportToGraphX(71), y = view.viewportToGraphY(53);
	view.setZoom(2, 71, 53);
	assert.equal(view.viewportToGraphX(71), x);
	assert.equal(view.viewportToGraphY(53), y);
	assert.equal(view.graphToViewportX(x), 71);
	assert.equal(view.graphToViewportY(y), 53);
	assert.equal(view.scrollBounds.left, model.bounds.left * 2 - (view.bounds.right - view.bounds.left));
	assert.equal(view.scrollBounds.bottom, model.bounds.bottom * 2);
	view.reveal(b);
	assert.ok(view.hitTest(view.graphToViewportX(b.bounds.left) + 8, view.graphToViewportY(b.bounds.top) + 8) === b);
	assert.equal(view.selection, b);
	assert.equal(view.model, model);
	assert.equal(JSON.stringify(model), geometry);
	const transform = view.transform;
	view.pan(2, 3);
	assert.equal(view.transform, transform, 'draw transforms are retained, including scrollbar-driven pan');
	assert.equal(transform.offsetX, view.bounds.left - view.scrollX);
	assert.equal(transform.offsetY, view.bounds.top - view.scrollY);
	view.setZoom(100);
	assert.equal(view.zoom, GRAPH_ZOOM_MAX);
	view.setZoom(0.001);
	assert.equal(view.zoom, GRAPH_ZOOM_MIN);
});

test('zoomed route hits keep a three-screen-pixel tolerance and four-sided canvas clipping', () => {
	for (const zoom of [0.25, 0.5, 1.2, 2, 4]) {
		const { view, edge } = fixture();
		view.setZoom(zoom);
		view.reveal(edge);
		const x = view.graphToViewportX(-20) + 12;
		const y = view.graphToViewportY(45);
		assert.equal(view.hitTest(x, y + 2.9), edge, `hit tolerance at ${zoom}x`);
		assert.equal(view.hitTest(x, y + 3.1), null, `outside tolerance at ${zoom}x`);
		assert.equal(view.hitTest(view.bounds.left - 1, y), null);
		assert.equal(view.hitTest(view.bounds.right, y), null);
	}
});

test('zoom commands belong to graph focus; wheel zoom is pointer anchored and revokes pending capture', () => {
	const f = dragFixture();
	const x = f.view.viewportToGraphX(60), y = f.view.viewportToGraphY(60);
	assert.equal(f.control.handleWheel(pointer(60, 60), 0, 0, 1), true);
	assert.equal(f.view.zoom, 1.2);
	assert.equal(f.view.viewportToGraphX(60), x);
	assert.equal(f.view.viewportToGraphY(60), y);
	assert.equal(f.capture.dispatch(pointer(70, 60, true), false, 20), false, 'zoom revokes the press, even before its drag threshold');
	assert.equal(f.counts.starts, 0);
	assert.equal(f.control.handleWheel(pointer(121, 60), 0, 0, 1), false);
	f.focus.executeCommand('graph.resetZoom');
	assert.equal(f.view.zoom, 1);
	assert.equal(f.focus.getCommand('graph.resetZoom')!.isEnabled(), false);
	f.control.clearInput();
	assert.equal(f.control.focusTarget.getCommand('graph.zoomIn')!.isEnabled(), false);
	f.control.dispose();
});

test('zoom changes cancel an accepted drag without mutating source; a new drag uses inverse-scaled offsets', () => {
	const f = dragFixture();
	f.capture.dispatch(pointer(60, 60, true), false, 20);
	assert.equal(f.feedback.accepted, true);
	f.view.setZoom(2, 22, 22);
	f.control.update();
	assert.equal(f.control.dragFeedback, undefined);
	f.control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 40);
	f.capture.dispatch(pointer(62, 62, true), false, 60);
	assert.equal(f.feedback.offsetX, 20);
	assert.equal(f.feedback.offsetY, 20);
	assert.equal(f.counts.drops, 0);
	f.control.dispose();
});

test('stationary pointer polling reuses the hit result until geometry, viewport or pointer changes', () => {
	class MeasuredViewport extends WorkbenchGraphViewport {
		public hitTests = 0;
		public override hitTest(x: number, y: number) {
			this.hitTests += 1;
			return super.hitTest(x, y);
		}
	}
	const { model } = fixture();
	const view = new MeasuredViewport(model);
	view.layout(20, 20, 120, 100);
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(view);
	const position = pointer(22, 22);
	for (let frame = 0; frame < 100; frame += 1) control.handlePointer({ ...position, justPressedButtons: 0 }, frame);
	assert.equal(view.hitTests, 1);
	view.pan(2, 0);
	control.handlePointer({ ...position, justPressedButtons: 0 }, 101);
	assert.equal(view.hitTests, 2);
	view.layout(21, 20, 121, 100);
	control.handlePointer({ ...position, justPressedButtons: 0 }, 102);
	assert.equal(view.hitTests, 3);
	view.setModel({ ...model }, null);
	control.handlePointer({ ...position, justPressedButtons: 0 }, 103);
	assert.equal(view.hitTests, 4);
	control.dispose();
});

/** A domain consumer, independent of Lua, tests the shared gesture lifecycle. */
function dragFixture() {
	const f = fixture();
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(focus, capture);
	const counts = { starts: 0, overs: 0, drops: 0, current: true };
	const feedback = { kind: 'node-insertion' as const, source: f.a, marker: { left: 40, top: 10, right: 42, bottom: 30 }, offsetX: 0, offsetY: 0, accepted: false };
	control.setInput(f.view, { begin: () => {
		counts.starts += 1;
		return {
			feedback,
			isCurrent: () => counts.current,
			dragOver: (x: number) => { counts.overs += 1; feedback.accepted = x >= 60; },
			drop: () => {
				assert.equal(control.dragFeedback, undefined, 'gesture detaches before the domain edits or navigates');
				counts.drops += 1;
			},
		};
	} });
	control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 0);
	return { ...f, control, capture, focus, feedback, counts };
}

test('a click allocates no drag session and still double-clicks; threshold begins a preview without a drop', () => {
	const f = dragFixture();
	f.capture.dispatch(pointer(24, 24, true), false, 20);
	assert.equal(f.counts.starts, 0);
	f.capture.dispatch({ ...pointer(24, 24), justReleasedButtons: PointerButton.Primary }, false, 40);
	assert.equal(f.control.dragFeedback, undefined);
	assert.equal(f.counts.drops, 0);
	assert.equal(f.control.handlePointer({ ...pointer(22, 22, true), justPressedButtons: PointerButton.Primary }, 60), Result.Activate);
	assert.equal(f.counts.starts, 0);
	f.control.dispose();
});

test('drag movement retains geometry and feedback; release commits once at the actual release target', () => {
	const f = dragFixture();
	const geometry = JSON.stringify(f.model);
	f.capture.dispatch(pointer(60, 60, true), false, 20);
	assert.equal(f.control.dragFeedback, f.feedback);
	assert.equal(f.counts.drops, 0);
	for (let frame = 2; frame < 102; frame += 1) f.capture.dispatch(pointer(60, 60, true), false, frame * 20);
	assert.equal(f.counts.starts, 1);
	assert.equal(f.counts.overs, 1, 'stationary warm polling performs no repeated domain hit work');
	assert.equal(JSON.stringify(f.model), geometry, 'preview does not move retained model nodes');
	f.capture.dispatch({ ...pointer(70, 60), justReleasedButtons: PointerButton.Primary }, false, 2040);
	assert.equal(f.counts.drops, 1);
	assert.equal(f.counts.overs, 2, 'release position supersedes previous hover');
	f.capture.dispatch({ ...pointer(70, 60), justReleasedButtons: PointerButton.Primary }, false, 2060);
	assert.equal(f.counts.drops, 1);
	f.control.dispose();
});

test('release over invalid space, outside the graph, or consumed input cannot commit a previously accepted target', () => {
	for (const [x, y, released] of [[50, 60, true], [121, 60, true], [60, 60, false]] as const) {
		const f = dragFixture();
		f.capture.dispatch(pointer(60, 60, true), false, 20);
		assert.equal(f.feedback.accepted, true);
		f.capture.dispatch({ ...pointer(x, y), justReleasedButtons: released ? PointerButton.Primary : 0 }, false, 40);
		assert.equal(f.counts.drops, 0);
		assert.equal(f.control.dragFeedback, undefined);
		f.control.dispose();
	}
});

test('coalesced press/move/release uses the same threshold and a single drop', () => {
	const f = dragFixture();
	f.capture.dispatch({ ...pointer(60, 60), justReleasedButtons: PointerButton.Primary }, false, 20);
	assert.equal(f.counts.starts, 1);
	assert.equal(f.counts.overs, 1);
	assert.equal(f.counts.drops, 1);
	f.control.dispose();
});

test('blur, detachment, model generation and domain invalidation clear feedback without waiting for pointer motion', () => {
	for (const interrupt of ['blur', 'detach', 'model', 'domain', 'selection'] as const) {
		const f = dragFixture();
		f.capture.dispatch(pointer(60, 60, true), false, 20);
		if (interrupt === 'blur') f.focus.setTarget(null);
		else if (interrupt === 'detach') { f.control.clearInput(); f.control.setInput(f.view); }
		else if (interrupt === 'model') f.view.setModel({ ...f.model }, null);
		else if (interrupt === 'selection') f.view.selection = f.b;
		else f.counts.current = false;
		f.control.update();
		assert.equal(f.control.dragFeedback, undefined);
		assert.equal(f.capture.dispatch({ ...pointer(70, 60), justReleasedButtons: PointerButton.Primary }, false, 40), false);
		assert.equal(f.counts.drops, 0);
		f.control.dispose();
	}
});

test('a pending drag cannot adopt a selection chosen after the physical press', () => {
	const f = dragFixture();
	f.view.selection = f.b;
	f.capture.dispatch(pointer(60, 60, true), false, 20);
	assert.equal(f.counts.starts, 0);
	f.capture.dispatch({ ...pointer(60, 60), justReleasedButtons: PointerButton.Primary }, false, 40);
	assert.equal(f.counts.drops, 0);
	f.control.dispose();
});

test('edge scrolling is host-time based and keeps the payload, not frame-paced or a new source projection', () => {
	const results: number[] = [];
	for (const fps of [50, 60, 120]) {
		const f = dragFixture();
		f.capture.dispatch(pointer(f.view.bounds.right - 1, 60, true), false, 20);
		for (let frame = 1; frame <= fps; frame += 1) f.capture.dispatch(pointer(f.view.bounds.right - 1, 60, true), false, 20 + frame * 1000 / fps);
		results.push(f.view.scrollX);
		assert.equal(f.counts.starts, 1);
		assert.equal(f.view.model, f.model);
		f.control.dispose();
	}
	for (const x of results) assert.ok(Math.abs(x - 110) < 1e-9);
});

test('drag preview reuses clipped overlay command and glyph storage without changing the graph', () => {
	const f = dragFixture();
	f.capture.dispatch(pointer(60, 60, true), false, 20);
	const geometry = JSON.stringify(f.model);
	const { presenter, renderer, queue } = createHostOverlayFixture(160, 120);
	const draw = () => {
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		drawWorkbenchGraph(f.view, f.control.hover, true, f.control.dragFeedback);
		renderer.endFrame();
		return queue.consumeOverlayFrame();
	};
	const first = draw();
	const refs = first.commandRefs.slice(0, first.commandCount);
	draw();
	for (let frame = 0; frame < 50; frame += 1) {
		const current = draw();
		assert.equal(current.commandCount, refs.length);
		for (let index = 0; index < refs.length; index += 1) assert.equal(current.commandRefs[index], refs[index]);
		draw();
	}
	assert.equal(JSON.stringify(f.model), geometry);
	assert.equal(f.counts.starts, 1);
	assert.equal(f.counts.overs, 1);
	assert.equal(f.control.dragFeedback, f.feedback);
	f.control.dispose();
});

test('wheel scrolling during a drag refreshes insertion feedback without replacing its source or committing', () => {
	const f = dragFixture();
	const position = pointer(60, 60, true);
	f.capture.dispatch(position, false, 20);
	assert.equal(f.control.handleWheel(position, 10, 4), true);
	assert.deepEqual([f.view.scrollX, f.view.scrollY], [10, 4]);
	assert.equal(f.control.dragFeedback, f.feedback);
	assert.equal(f.counts.overs, 2);
	assert.equal(f.counts.starts, 1);
	assert.equal(f.counts.drops, 0);
	f.capture.dispatch({ ...pointer(60, 60), justReleasedButtons: PointerButton.Primary }, false, 40);
	assert.equal(f.counts.drops, 1);
	assert.equal(f.counts.overs, 2, 'release at the same world position reuses the wheel-refreshed target');
	f.control.dispose();
});

test('secondary gestures select the exact node, edge or empty canvas without pan, drag or activation', () => {
	const { view, a, edge } = fixture();
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	let dragCalls = 0;
	const control = new WorkbenchGraphControl(focus, capture);
	control.setInput(view, { begin() { dragCalls += 1; return undefined; } });
	for (const [x, y, target] of [[21, 21, a], [21, 65, edge], [100, 95, null]] as const) {
		const event = pointer(x, y);
		event.pressedButtons = PointerButton.Secondary;
		event.justPressedButtons = PointerButton.Secondary;
		assert.equal(control.handlePointer(event, 0), Result.ContextMenu);
		assert.equal(view.selection, target);
		assert.equal(focus.target, control.focusTarget);
		assert.equal(capture.active, false);
	}
	assert.equal(dragCalls, 0);
	control.dispose();
});
