import { PointerButton } from '../../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { InputFocusService } from '../../../ide/input/focus';
import { PointerCaptureService } from '../../../ide/input/pointer/capture';
import { WorkbenchGraphControl } from '../../../ide/workbench/ui/graph/control';
import { api } from '../../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../../ide/workbench/ui/graph/model';
import { graphConnectionFixture } from '../../helpers/graph_connection_fixture';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { medianMilliseconds } from '../../helpers/performance';

class MeasuredFont extends Font {
	public measurements = 0;
	public override measure(text: string): number { this.measurements += 1; return super.measure(text); }
}

for (const nodeCount of [4, 1024]) {
	const font = new MeasuredFont({ variant: 'tiny' });
	const f = graphConnectionFixture(font);
	// The viewport still hits the real retained model, including its offscreen cards.
	const nodes = [...f.model.nodes];
	for (let i = nodes.length; i < nodeCount; i += 1) nodes.push(createWorkbenchGraphNode(font, `OFFSCREEN ${i}`, 400 + i * 50, 40));
	f.view.setModel(createWorkbenchGraphModel(font, nodes, f.model.edges), f.edge);
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture);
	control.setInput(f.view, f.interaction);
	const from = { valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0, viewportX: 250, viewportY: 79 };
	const to = { ...from, viewportX: 256, viewportY: 170 };
	const alternate = { ...to, viewportX: to.viewportX + 1 };
	control.handlePointer(from, 0);
	const handles = control.connectionHandles;
	const stationaryHoverMicroseconds = medianMilliseconds(() => { for (let i = 0; i < 1000; i += 1) control.handlePointer(from, 0); });
	from.justPressedButtons = PointerButton.Primary;
	control.handlePointer(from, 0);
	capture.dispatch(to, false, 20);
	const feedback = f.interaction.feedback!;
	const overs = f.interaction.overs;
	const stationaryDragMicroseconds = medianMilliseconds(() => { for (let i = 0; i < 1000; i += 1) capture.dispatch(to, false, 20); });
	assert.equal(f.interaction.overs, overs);
	const movingDragMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) capture.dispatch(i % 2 === 0 ? alternate : to, false, 20);
	});
	const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		renderer.beginFrame(presenter); api.beginFrame(renderer);
		drawWorkbenchGraph(f.view, control.hover, true, control.dragFeedback, control.connectionHandles);
		renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		stream.reset(384, 288);
		for (let i = 0; i < frame.commandCount; i += 1) stream.appendEntry(frame.commandKinds[i], frame.commandRefs[i]);
	};
	for (let i = 0; i < 1000; i += 1) draw();
	const quadStorage = stream.floatData;
	const fontMeasurements = font.measurements;
	const previewAndQuadsMicroseconds = medianMilliseconds(() => { for (let i = 0; i < 1000; i += 1) draw(); });
	assert.equal(control.dragFeedback, feedback); assert.equal(control.connectionHandles, handles);
	assert.equal(f.interaction.starts.length, 1); assert.equal(f.interaction.drops.length, 0);
	assert.equal(stream.floatData, quadStorage); assert.equal(font.measurements, fontMeasurements);
	console.log(JSON.stringify({ nodes: nodeCount, stationaryHoverMicroseconds, stationaryDragMicroseconds, movingDragMicroseconds,
		previewAndQuadsMicroseconds, stationaryTargetQueries: 0, warmFontMeasurements: 0, retainedQuadStorage: true,
		boundary: 'warm control + retained preview/overlay quad stream; no source analysis, layout, GPU raster or guest execution' }));
	control.dispose();
}
