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
import { createWorkbenchGraphEdge, createWorkbenchGraphNode, type WorkbenchGraphModel } from '../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult as Result } from '../../ide/workbench/ui/graph/control';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const font = new Font({ variant: 'tiny' });
function fixture() {
	const a = createWorkbenchGraphNode(font, 'FIRST\nDETAIL', -10, -4);
	const b = createWorkbenchGraphNode(font, 'SECOND', 100, 70);
	const edge = createWorkbenchGraphEdge([-20, 45, 140, 45, 140, 75]);
	const model: WorkbenchGraphModel = { font, nodes: [a, b], edges: [edge] };
	const view = new WorkbenchGraphViewport(model);
	view.layout(20, 20, 120, 100);
	return { view, a, b, edge, model };
}
function pointer(x: number, y: number, pressed = false): PointerSnapshot {
	return { viewportX: x, viewportY: y, primaryPressed: pressed, valid: true, insideViewport: true };
}

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
	view.setModel({ font, nodes: [a, top], edges: [edge] }, null);
	assert.equal(view.hitTest(20, 20), top);
});

test('edge hit testing chooses the nearest retained segment, including zero-length routes', () => {
	const { view } = fixture();
	const first = createWorkbenchGraphEdge([0, 0, 80, 80]);
	const nearest = createWorkbenchGraphEdge([0, 3, 80, 83]);
	const point = createWorkbenchGraphEdge([50, 10, 50, 10]);
	view.setModel({ font, nodes: [], edges: [first, nearest, point] }, null);
	assert.equal(view.hitTest(60, 61), first);
	assert.equal(view.hitTest(60, 63), nearest);
	assert.equal(view.hitTest(70, 30), point);
	const top = createWorkbenchGraphEdge(first.points);
	view.setModel({ font, nodes: [], edges: [first, top] }, null);
	assert.equal(view.hitTest(60, 60), top, 'ties respect reverse paint order');
});

test('reveal minimally scrolls into view and aligns oversized subjects instead of shrinking the font', () => {
	const { view, b, edge } = fixture();
	view.reveal(b);
	assert.equal(view.scrollX, b.bounds.right - 100 + 6);
	assert.equal(view.scrollY, b.bounds.bottom - 80 + 6);
	const x = view.scrollX;
	const y = view.scrollY;
	view.reveal(b);
	assert.equal(view.scrollX, x);
	assert.equal(view.scrollY, y);
	view.reveal(edge);
	assert.equal(view.scrollX, -26);
});

test('only a physical press begins a pan; capture can leave the control but cannot cross blur or attachment', () => {
	const { view } = fixture();
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(focus, capture);
	control.setInput(view);
	control.handlePointer(pointer(80, 95, true), false, 0);
	control.handlePointer(pointer(90, 95, true), false, 1);
	assert.equal(view.scrollX, 0, 'held pointer entering a pane is not a press');
	control.handlePointer(pointer(80, 95, true), true, 2);
	assert.equal(focus.target, control.focusTarget);
	assert.equal(capture.dispatch(pointer(140, 110, true), false), true);
	assert.deepEqual([view.scrollX, view.scrollY], [-60, -15]);
	focus.setTarget(null);
	control.handlePointer(pointer(90, 90, true), false, 4);
	assert.equal(view.scrollX, -60, 'blur cancels capture');
	control.clearInput();
	control.setInput(view);
	control.handlePointer(pointer(80, 95, true), false, 5);
	control.handlePointer(pointer(90, 90, true), false, 6);
	assert.equal(view.scrollX, -60, 'reattaching retains viewport, not gesture');
	control.dispose();
});

test('selection and activation use retained item identity, never coordinates reused by a new model', () => {
	const { view, a, model } = fixture();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(view);
	assert.equal(control.handlePointer(pointer(22, 22, true), true, 0), Result.Handled);
	assert.equal(view.selection, a);
	control.handlePointer(pointer(22, 22), false, 1);
	assert.equal(control.handlePointer(pointer(22, 22, true), true, 50), Result.Activate);
	control.handlePointer(pointer(22, 22), false, 51);
	control.handlePointer(pointer(22, 22, true), true, 100);
	const replacement = createWorkbenchGraphNode(font, 'FIRST\nDETAIL', -10, -4);
	view.setModel({ ...model, nodes: [replacement] }, null);
	control.handlePointer(pointer(22, 22), false, 101);
	assert.equal(control.handlePointer(pointer(22, 22, true), true, 150), Result.Handled);
	assert.equal(view.selection, replacement);
	control.dispose();
});

test('model replacement cancels a pan; empty-space clicks and wheel are bounded to the control', () => {
	const { view, a, model } = fixture();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(view);
	view.selection = a;
	assert.equal(control.handlePointer(pointer(10, 10, true), true, 0), Result.Outside);
	assert.equal(view.selection, a);
	control.handlePointer(pointer(80, 95, true), true, 1);
	assert.equal(view.selection, null);
	view.setModel({ ...model }, null);
	assert.equal(capture.dispatch(pointer(100, 95, true), false), true);
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
	assert.deepEqual(points.slice(0, 4), [0, 65, 160, 65]);
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
	for (let frame = 0; frame < 100; frame += 1) control.handlePointer(position, false, frame);
	assert.equal(view.hitTests, 1);
	view.pan(2, 0);
	control.handlePointer(position, false, 101);
	assert.equal(view.hitTests, 2);
	view.layout(21, 20, 121, 100);
	control.handlePointer(position, false, 102);
	assert.equal(view.hitTests, 3);
	view.setModel({ ...model }, null);
	control.handlePointer(position, false, 103);
	assert.equal(view.hitTests, 4);
	control.dispose();
});
