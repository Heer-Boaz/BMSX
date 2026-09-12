import { semanticSnapshot } from '../../lua/semantic_test_harness';
import { PointerHoverService } from '../../../ide/input/pointer/hover';
import { PointerButton } from '../../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { beginBehaviorTreeDrag } from '../../../ide/workbench/contrib/behavior_lens/behavior_tree_drag';
import { WorkbenchGraphControl } from '../../../ide/workbench/ui/graph/control';
import { InputFocusService } from '../../../ide/input/focus';
import { PointerCaptureService } from '../../../ide/input/pointer/capture';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { api } from '../../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';

Object.assign(editorViewState, { font: new EditorFont('tiny'), viewportWidth: 384, viewportHeight: 288, lineHeight: 6, codeAreaTop: 24, codeAreaBottom: 276 });
for (const siblings of [24, 1024]) {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')\nlocal child<const> = { type = 'wait', duration_ticks = 2 }\ntrees.register('profile', { root = { type = 'sequence', children = { ${'child,'.repeat(siblings)} } } })`;
	const model = new EditorTextModel({ domain: 0, path: 'drag.lua', source: { type: 'lua', resid: 'drag' } }, 'lua', source);
	const document = buildBehaviorSourceDocument(model.resource, semanticSnapshot(buildLuaFileSemanticData(source, model.resource.path)));
	const state = createBehaviorLensViewState(document, model, 'graph', assert.fail);
	selectBehaviorLensDefinition(state, document.definitions[0].rowKey);
	prepareBehaviorLensLayout(state);
	assert.ok(state.presentation.kind === 'graph');
	const viewport = state.presentation.viewport;
	const graph = viewport.model;
	const [first, second] = graph.nodes[0].children[0].children;
	viewport.scrollX = first.bounds.left - 16;
	viewport.scrollY = first.bounds.top - 30;
	let starts = 0;
	let hits = 0;
	const hitTest = viewport.hitTest.bind(viewport);
	viewport.hitTest = (x, y) => { hits += 1; return hitTest(x, y); };
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(new InputFocusService(), capture, new PointerHoverService());
	control.setInput(viewport, { begin: () => { starts += 1; return beginBehaviorTreeDrag(model, state); } });
	const from = { viewportX: viewport.bounds.left + 20, viewportY: viewport.bounds.top + 34, valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0 };
	const to = { ...from, viewportX: second.bounds.right - 4 + viewport.bounds.left - viewport.scrollX };
	const alternate = { ...to, viewportX: to.viewportX - 2 };
	control.handlePointer(from, 0);
	const idleHitCount = hits;
	const stationaryHoverMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) control.handlePointer(from, 0);
	});
	assert.equal(hits, idleHitCount);
	from.justPressedButtons = PointerButton.Primary;
	control.handlePointer(from, 0);
	capture.dispatch(to, false, 20);
	assert.ok(control.dragFeedback?.accepted);
	const dragHitCount = hits;
	const stationaryDragMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) capture.dispatch(to, false, 20);
	});
	const stationaryHits = hits - dragHitCount;
	assert.equal(stationaryHits, 0, 'no stationary target queries');
	const movingDragMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) capture.dispatch(index % 2 === 0 ? alternate : to, false, 20);
	});
	const { presenter, queue, renderer } = createHostOverlayFixture(384, 288);
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		drawWorkbenchGraph(viewport, control.hover, true, control.dragFeedback);
		renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		stream.reset(384, 288);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
	};
	for (let index = 0; index < 1000; index += 1) draw();
	const quadStorage = stream.floatData;
	const feedback = control.dragFeedback;
	const previewAndQuadsMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) draw(); });
	assert.equal(stream.floatData, quadStorage);
	assert.equal(control.dragFeedback, feedback);
	assert.equal(starts, 1);
	assert.equal(viewport.model, graph);
	assert.equal(state.document, document);
	assert.equal(model.canUndo, false);
	assert.equal(model.dirty, false);
	console.log(JSON.stringify({ siblings, nodes: graph.nodes.length, stationaryHoverMicroseconds, stationaryDragMicroseconds,
		movingDragMicroseconds, previewAndQuadsMicroseconds, dragSessions: starts, stationaryHits,
		boundary: '1000-operation batches, 10 warmups, median of 25; excludes parsing, source edits, GPU raster/upload and total host frames; retained-storage assertions are not heap profiling' }));
	control.dispose();
}
