import { performance } from 'node:perf_hooks';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { InputFocusService } from '../../../ide/input/focus';
import { PointerCaptureService } from '../../../ide/input/pointer/capture';
import { api } from '../../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { createWorkbenchGraphNode, createWorkbenchGraphEdge, createWorkbenchGraphModel, type WorkbenchGraphEdge } from '../../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import { WorkbenchGraphControl } from '../../../ide/workbench/ui/graph/control';
import { createHostOverlayFixture } from '../../helpers/host_overlay';

class MeasuredFont extends Font {
	public measures = 0;
	public override measure(text: string): number { this.measures += 1; return super.measure(text); }
}
class MeasuredViewport extends WorkbenchGraphViewport {
	public hitTests = 0;
	public override hitTest(x: number, y: number) { this.hitTests += 1; return super.hitTest(x, y); }
}
const font = new MeasuredFont({ variant: 'tiny' });
const coldStart = performance.now();
const nodes = Array.from({ length: 256 }, (_, index) => createWorkbenchGraphNode(font, `NODE ${index}\nDETAIL`, index % 16 * 80, (index >> 4) * 40));
const edges: WorkbenchGraphEdge[] = [];
for (let index = 1; index < nodes.length; index += 1) {
	const from = nodes[index - 1].bounds;
	const to = nodes[index].bounds;
	edges.push(createWorkbenchGraphEdge([from.right, from.top + 8, to.left, to.top + 8]));
}
const coldMilliseconds = performance.now() - coldStart;
const view = new MeasuredViewport(createWorkbenchGraphModel(font, nodes, edges));
view.layout(8, 24, 376, 240);
const control = new WorkbenchGraphControl(new InputFocusService(), new PointerCaptureService());
control.setInput(view);
const snapshot = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, viewportX: 40, viewportY: 50 };
const { presenter, queue, renderer } = createHostOverlayFixture(384, 288);
const stream = new HostOverlayQuadStream();
const draw = () => {
	renderer.beginFrame(presenter);
	api.beginFrame(renderer);
	drawWorkbenchGraph(view, control.hover, false);
	renderer.endFrame();
	const frame = queue.consumeOverlayFrame();
	stream.reset(384, 288);
	for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
};
for (let index = 0; index < 1000; index += 1) draw();
const storage = stream.floatData;
const measures = font.measures;
const frames = 5000;
const idleStart = performance.now();
for (let index = 0; index < frames; index += 1) { control.handlePointer(snapshot, index); draw(); }
const idleMicroseconds = (performance.now() - idleStart) * 1000 / frames;
const stationaryHitTests = view.hitTests;
const panStart = performance.now();
for (let index = 0; index < frames; index += 1) {
	view.scrollX = index % 160;
	view.scrollY = index % 80;
	control.handlePointer(snapshot, index);
	draw();
}
const panMicroseconds = (performance.now() - panStart) * 1000 / frames;
console.log(JSON.stringify({ nodes: nodes.length, edges: edges.length, framesPerPhase: frames, coldMilliseconds,
	idleMicroseconds, panMicroseconds, stationaryHitTests, warmFontMeasurements: font.measures - measures,
	retainedQuadStorage: stream.floatData === storage, finalVisibleQuads: stream.count,
	boundary: 'host canvas command emission + quad stream; excludes Lua projection and GPU rasterization' }, null, 2));
control.dispose();
