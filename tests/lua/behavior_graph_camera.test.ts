import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { BehaviorLensController } from '../../ide/workbench/contrib/behavior_lens/controller';
import { BehaviorLensInputSerializer } from '../../ide/workbench/contrib/behavior_lens/editor_serializer';
import { prepareBehaviorGraphLayout } from '../../ide/workbench/contrib/behavior_lens/graph_layout';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { BehaviorLensNavigationSelection } from '../../ide/workbench/contrib/behavior_lens/navigation_selection';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { acceptStateGraphSelection } from '../../ide/workbench/contrib/behavior_lens/state_graph_navigation';
import { captureBehaviorLensView } from '../../ide/workbench/contrib/behavior_lens/view_snapshot';
import type { GraphLayoutEngineFactory } from '../../ide/workbench/services/graph_layout/engine';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { BEHAVIOR_SOURCE_FIXTURE } from '../helpers/behavior_source_fixture';
import { FSM_PROOF_SOURCE } from '../helpers/fsm_source_fixture';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

function fixture(t: TestContext, source = BEHAVIOR_SOURCE_FIXTURE, presentation: 'graph' | 'state-graph' = 'graph',
	createEngine: GraphLayoutEngineFactory = () => assert.fail('BT cameras do not create FSM layout workers')) {
	const previousFont = editorViewState.font;
	editorViewState.font = new EditorFont('tiny');
	const sources = createScenarioTestSourceState([
		['camera.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}'], ['cartlib/fsm/library.lua', 'return {}'],
	].map(([path, text]) => createScenarioTestSourceRecord(path, 1, text, `tests/fixtures/graph_camera/${path}`)));
	const documents = new BehaviorSourceDocuments(editorTextModelService, sources.catalog);
	const controller = new BehaviorLensController(sources, null!, documents, createEngine, null!, null!, null!, null!);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'camera.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	const input = controller.createInput(model, presentation), inputs = [input];
	selectBehaviorLensDefinition(input.view, input.view.document.definitions[0].rowKey);
	t.after(() => {
		for (const input of inputs) input.dispose();
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService);
		editorViewState.font = previousFont;
	});
	return { controller, input, inputs, model, sources, font: editorViewState.font.renderFont() };
}

/** Hold admission order while retaining the production worker's measured and routed result. */
class HeldEngine {
	public readonly jobs: { graph: ElkNode; resolve: (graph: ElkNode) => void }[] = [];
	public layout(graph: ElkNode): Promise<ElkNode> {
		return new Promise(resolve => this.jobs.push({ graph, resolve }));
	}
	public dispose(): void {}
}

test('authored FSM pending source/font generations revoke geometry without replacing the manual camera', async t => {
	const held = new HeldEngine(), real = new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs')));
	t.after(() => real.dispose());
	const f = fixture(t, FSM_PROOF_SOURCE, 'state-graph', () => held), view = f.input.view;
	assert.ok(view.presentation.kind === 'state-graph');
	const graph = view.presentation, viewport = graph.viewport;
	viewport.layout(0, 0, 384, 288);
	f.input.updatePresentation(f.font);
	const initialPending = graph.layoutState;
	assert.equal(initialPending.kind, 'pending');
	assert.equal(viewport.model.nodes.length, 0);
	held.jobs[0].resolve(await real.layout(held.jobs[0].graph));
	await f.input.graphLayout.settled;
	f.input.updatePresentation(f.font);
	const initialReady = graph.layoutState;
	assert.equal(initialReady.kind, 'ready');
	assert.equal(viewport.cameraMode, 'fit', 'the first admitted authored graph consumes initial fit intent');
	assert.ok(viewport.model.nodes.length > 0);
	viewport.selection = [...viewport.model.nodesBySource.values()].find(node => node.source.label === 'idle')!;
	acceptStateGraphSelection(view, graph);
	viewport.setZoom(2); viewport.pan(17, 11);
	const camera = viewport.captureViewState();
	for (const text of ['-- source generation\n', '-- newest generation\n']) {
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text }]);
		assert.equal(viewport.model.nodes.length, 0, 'hidden edits immediately revoke stale hit/draw geometry');
		assert.equal(viewport.selection, null);
		assert.deepEqual(viewport.captureViewState(), camera);
		f.controller.updateView(f.input); f.input.updatePresentation(f.font);
		const sourcePending = graph.layoutState;
		assert.equal(sourcePending.kind, 'pending');
	}
	assert.equal(held.jobs.length, 2, 'the latest source generation waits behind the older worker request');
	held.jobs[1].resolve(await real.layout(held.jobs[1].graph));
	await new Promise<void>(resolve => setImmediate(resolve));
	f.input.updatePresentation(f.font);
	assert.equal(held.jobs.length, 3);
	const obsoleteCompleted = graph.layoutState;
	assert.equal(obsoleteCompleted.kind, 'pending');
	assert.equal(viewport.model.nodes.length, 0, 'obsolete worker completion cannot publish a camera or geometry');
	assert.deepEqual(viewport.captureViewState(), camera);
	viewport.setZoom(3); viewport.pan(-9, 7);
	const reading = viewport.captureViewState();
	held.jobs[2].resolve(await real.layout(held.jobs[2].graph));
	await f.input.graphLayout.settled;
	f.input.updatePresentation(f.font);
	const sourceReady = graph.layoutState;
	assert.equal(sourceReady.kind, 'ready');
	assert.ok(viewport.selection?.kind === 'node');
	assert.deepEqual(viewport.captureViewState(), reading, 'navigation while pending belongs to the retained input');
	const nextFont = new Font({ variant: 'msx' });
	f.input.updatePresentation(nextFont);
	const fontPending = graph.layoutState;
	assert.equal(fontPending.kind, 'pending');
	assert.equal(viewport.model.nodes.length, 0);
	viewport.layout(20, 30, 660, 510);
	assert.deepEqual(viewport.captureViewState(), reading, 'a pending font generation can resize without losing its graph-space reading center');
	held.jobs[3].resolve(await real.layout(held.jobs[3].graph));
	await f.input.graphLayout.settled;
	f.input.updatePresentation(nextFont);
	const fontReady = graph.layoutState;
	assert.equal(fontReady.kind, 'ready');
	assert.equal(viewport.model.font, nextFont);
	assert.deepEqual(viewport.captureViewState(), reading);
});

// These geometry assertions are the source-correspondence camera algorithm contract:
// manual mode anchors the selected occurrence; fit mode frames the complete new extent.
for (const mode of ['fit', 'manual'] as const) for (const kind of ['node', 'edge'] as const)
	test(`BT reparse preserves ${kind} correspondence with ${mode} camera intent`, t => {
		const f = fixture(t), view = f.input.view;
		assert.ok(view.presentation.kind === 'graph');
		const graph = view.presentation, viewport = graph.viewport;
		viewport.layout(0, 0, 384, 288); prepareBehaviorGraphLayout(view, graph, f.font);
		const sequence = viewport.model.nodes[0].children[0], selectedNode = sequence.children[1];
		viewport.selection = kind === 'node' ? selectedNode : viewport.model.edgesBySource.get(selectedNode.source.rowKey)!;
		acceptBehaviorGraphSelection(view, graph);
		if (mode === 'manual') { viewport.setZoom(2); viewport.pan(13, 17); }
		const selected = viewport.selection, before = viewport.captureViewState();
		const screen = [viewport.graphToViewportX(selected.bounds.left), viewport.graphToViewportY(selected.bounds.top)];
		const insertion = luaSourceRangeToTextRange(f.model.buffer, sequence.children[0].source.occurrenceRange);
		f.model.pushEditOperations([{ offset: insertion.start, deleteLength: 0,
			text: "{ type = 'timeline', timeline_id = 'a much wider new sibling for camera correspondence' }, " }]);
		f.controller.updateView(f.input); prepareBehaviorGraphLayout(view, graph, f.font);
		assert.ok(viewport.selection?.kind === kind);
		assert.notEqual(viewport.selection, selected);
		const node = viewport.selection.kind === 'node' ? viewport.selection : viewport.selection.child;
		assert.equal(node.member!.index, 2, 'the selected source occurrence follows insertion rather than its former child index');
		assert.equal(viewport.cameraMode, mode);
		if (mode === 'manual') {
			assert.equal(viewport.zoom, before.scale);
			assert.deepEqual([viewport.graphToViewportX(viewport.selection.bounds.left), viewport.graphToViewportY(viewport.selection.bounds.top)], screen);
		} else {
			const bounds = viewport.model.bounds;
			assert.deepEqual(viewport.captureViewState(), { scale: 'fit', centerX: (bounds.left + bounds.right) / 2, centerY: (bounds.top + bounds.bottom) / 2 });
		}
	});

for (const mode of ['fit', 'manual'] as const)
	test(`Behavior clone, navigation and serialization retain independent ${mode} camera intent`, async t => {
		const f = fixture(t), view = f.input.view;
		assert.ok(view.presentation.kind === 'graph');
		const graph = view.presentation, viewport = graph.viewport;
		viewport.layout(0, 0, 384, 288); prepareBehaviorGraphLayout(view, graph, f.font);
		viewport.selection = viewport.model.nodes[0].children[0].children[1];
		acceptBehaviorGraphSelection(view, graph);
		if (mode === 'manual') { viewport.setZoom(2); viewport.pan(11, 19); }
		const saved = captureBehaviorLensView(f.input), history = new BehaviorLensNavigationSelection(f.input);
		assert.ok(saved.reading.kind === 'graph');
		t.after(() => history.dispose());
		const serializer = new BehaviorLensInputSerializer(f.sources.catalog, f.controller);
		const serialized = serializer.serialize(f.input), clone = f.input.createView!();
		const reopened = await serializer.deserialize(serialized);
		f.inputs.push(clone, reopened);
		for (const input of [clone, reopened]) {
			assert.equal(input.workingCopy, f.model);
			assert.ok(input.view.presentation.kind === 'graph');
			const sibling = input.view.presentation;
			sibling.viewport.layout(40, 20, 680, 500);
			prepareBehaviorGraphLayout(input.view, sibling, f.font);
			assert.notEqual(sibling.viewport, viewport);
			assert.equal(sibling.viewport.cameraMode, mode);
			assert.deepEqual(captureBehaviorLensView(input).selected, saved.selected);
			assert.deepEqual(sibling.viewport.captureViewState(), saved.reading.camera);
			sibling.viewport.setZoom(3); sibling.viewport.pan(31, 37);
			assert.deepEqual(viewport.captureViewState(), saved.reading.camera, 'sibling navigation cannot mutate the originating input');
		}
		viewport.setZoom(4); viewport.pan(-15, 23);
		history.restore(f.input);
		assert.deepEqual(viewport.captureViewState(), saved.reading.camera);
		viewport.layout(10, 15, 650, 495);
		assert.equal(viewport.cameraMode, mode);
		if (mode === 'manual') assert.deepEqual(viewport.captureViewState(), saved.reading.camera);
		assert.notDeepEqual(captureBehaviorLensView(reopened).reading, saved.reading, 'a reopened view owns its later manual navigation independently');
		assert.deepEqual(history.snapshot.reading, saved.reading, 'restoring or navigating cannot mutate the captured history value');
	});

test('a list reading bookmark supplies no invented camera when source navigation enters a diagram', t => {
	const f = fixture(t), input = f.controller.createInput(f.model, 'outline'); f.inputs.push(input);
	const view = input.view, subject = view.document.definitions[1];
	const outline = view.presentation; assert.ok(outline.kind === 'outline');
	view.selectionState.selectDefinition(subject.rowKey);
	outline.scroll = 17;
	const history = new BehaviorLensNavigationSelection(input); t.after(() => history.dispose());
	assert.deepEqual(history.snapshot.reading, { kind: 'list', scroll: 17 });
	selectBehaviorLensDefinition(view, view.document.definitions[0].rowKey);
	const graph = view.presentation; assert.ok(graph.kind === 'graph');
	graph.viewport.layout(0, 0, 400, 280);
	prepareBehaviorGraphLayout(view, graph, f.font);
	graph.viewport.setZoom(3); graph.viewport.pan(13, 19);
	history.restore(input);
	assert.equal(view.selectionState.definitionRowKey, subject.rowKey);
	assert.equal(graph.viewport.cameraMode, 'fit', 'the newly selected subject owns initial framing, not the prior diagram camera or list row scroll');
	assert.deepEqual(history.snapshot.reading, { kind: 'list', scroll: 17 });
});
