import assert from 'node:assert/strict';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { InputFocusService } from '../../../ide/input/focus';
import { PointerButton } from '../../../ide/input/pointer/buttons';
import { PointerCaptureService } from '../../../ide/input/pointer/capture';
import type { PointerSnapshot } from '../../../ide/common/models';
import { WorkbenchGraphControl } from '../../../ide/workbench/ui/graph/control';
import { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import { createWorkbenchGraphModel, createWorkbenchGraphNode, createWorkbenchGraphEdge } from '../../../ide/workbench/ui/graph/model';
import { api } from '../../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { medianMilliseconds } from '../../helpers/performance';

class MeasuredFont extends Font {
	public measurements = 0;
	public override measure(text: string): number { this.measurements += 1; return super.measure(text); }
}
class MeasuredViewport extends WorkbenchGraphViewport {
	public hits = 0;
	public override hitTest(x: number, y: number) { this.hits += 1; return super.hitTest(x, y); }
}

for (const nodeCount of [32, 1024]) {
	const font = new MeasuredFont({ variant: 'tiny' });
	const nodes = Array.from({ length: nodeCount }, (_, index) => createWorkbenchGraphNode(font,
		`NODE ${index}\nDETAIL`, index % 8 * 80, (index >> 3) * 40));
	const edges = nodes.slice(1).map((node, index) => createWorkbenchGraphEdge([
		nodes[index].bounds.right, nodes[index].bounds.top + 8, node.bounds.left, node.bounds.top + 8,
	]));
	let model = createWorkbenchGraphModel(font, nodes, edges);
	const publishMilliseconds = medianMilliseconds(() => { model = createWorkbenchGraphModel(font, nodes, edges); });
	const view = new MeasuredViewport(model);
	view.layout(8, 24, 376, 260);
	view.selection = nodes[0];
	const bounds = view.bounds;
	const scrollBounds = view.scrollBounds;
	const horizontalTrack = view.horizontalScrollbar.getTrack();
	const horizontalThumb = view.horizontalScrollbar.getThumb();
	const verticalThumb = view.verticalScrollbar.getThumb();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(view);
	const measurements = font.measurements;
	const pointer: PointerSnapshot = { valid: true, insideViewport: true, pressedButtons: PointerButton.Auxiliary,
		justPressedButtons: PointerButton.Auxiliary, justReleasedButtons: 0, viewportX: 40, viewportY: 50 };
	control.handlePointer(pointer, 0);
	pointer.justPressedButtons = 0;
	const stationaryCaptureMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) capture.dispatch(pointer, false, 20);
	});
	const movingCaptureMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) {
			pointer.viewportX = 40 + i % 2; pointer.viewportY = 50 + i % 2;
			capture.dispatch(pointer, false, 20);
		}
	});
	pointer.pressedButtons = 0; pointer.justReleasedButtons = PointerButton.Auxiliary;
	capture.dispatch(pointer, false, 40);
	const unchangedLayoutMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) view.layout(8, 24, 376, 260);
	});
	const resizeMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) view.layout(8, 24, 376 - i % 2, 260 - i % 2);
	});
	view.layout(8, 24, 376, 260);
	const thumb = view.horizontalScrollbar.getThumb()!;
	pointer.viewportX = (thumb.left + thumb.right) / 2; pointer.viewportY = thumb.top + 1;
	pointer.pressedButtons = pointer.justPressedButtons = PointerButton.Primary; pointer.justReleasedButtons = 0;
	control.handlePointer(pointer, 60);
	pointer.justPressedButtons = 0;
	const thumbAnchor = pointer.viewportX;
	const movingThumbMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) {
			pointer.viewportX = thumbAnchor + i % 2;
			capture.dispatch(pointer, false, 80);
		}
	});
	pointer.pressedButtons = 0; pointer.justReleasedButtons = PointerButton.Primary;
	capture.dispatch(pointer, false, 100);
	view.scrollX = 0; view.scrollY = 0;
	const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		renderer.beginFrame(presenter); api.beginFrame(renderer);
		drawWorkbenchGraph(view, control.hover, true);
		renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		stream.reset(384, 288);
		for (let i = 0; i < frame.commandCount; i += 1) stream.appendEntry(frame.commandKinds[i], frame.commandRefs[i]);
	};
	for (let i = 0; i < 1000; i += 1) draw();
	const storage = stream.floatData;
	const drawAndQuadsMicroseconds = medianMilliseconds(() => { for (let i = 0; i < 1000; i += 1) draw(); });
	assert.equal(view.hits, 0); assert.equal(view.model, model); assert.equal(view.selection, nodes[0]);
	assert.equal(view.bounds, bounds); assert.equal(view.scrollBounds, scrollBounds);
	assert.equal(view.horizontalScrollbar.getTrack(), horizontalTrack);
	assert.equal(view.horizontalScrollbar.getThumb(), horizontalThumb); assert.equal(view.verticalScrollbar.getThumb(), verticalThumb);
	assert.equal(stream.floatData, storage); assert.equal(font.measurements, measurements);
	console.log(JSON.stringify({ nodes: nodeCount, edges: edges.length, publishMilliseconds,
		stationaryCaptureMicroseconds, movingCaptureMicroseconds, unchangedLayoutMicroseconds, resizeMicroseconds,
		movingThumbMicroseconds, drawAndQuadsMicroseconds, visibleQuads: stream.count, panAndScrollbarHits: view.hits,
		warmFontMeasurements: 0, retainedViewportGeometry: true, retainedQuadStorage: true,
		boundary: 'publication then warm captured input/viewport and overlay quad emission; excludes DOM polling, Lua projection, GPU, guest and heap/GC' }));
	control.dispose();
}
