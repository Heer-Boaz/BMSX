import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import type { GraphLayoutEngineFactory } from '../../ide/workbench/services/graph_layout/engine';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { installBehaviorLensDocument, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { acceptStateGraphSelection, stateGraphSelection } from '../../ide/workbench/contrib/behavior_lens/state_graph_navigation';
import { buildStateMachineDetails } from '../../ide/workbench/contrib/behavior_lens/state_machine_details';
import { selectStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { FSM_DIAGRAM_SOURCE, FSM_PROOF_SOURCE } from '../helpers/fsm_source_fixture';

const font = new Font({ variant: 'tiny' });
function fixture(source = FSM_PROOF_SOURCE, factory: GraphLayoutEngineFactory = () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs')))) {
	Object.assign(editorViewState, { font: new EditorFont('tiny') });
	const resource = { domain: 0 as const, path: 'graph.lua', source: { resid: 'graph', type: 'lua' as const } };
	const model = new EditorTextModel(resource, 'lua', source);
	const document = () => buildBehaviorSourceDocument(resource, buildLuaFileSemanticData(model.buffer.getText(), resource.path));
	const view = createBehaviorLensViewState(document(), model, 'outline');
	const input = new BehaviorLensInput(model, view, factory);
	model.onDidChangeContent(event => { mapBehaviorLensSourceRanges(view, event.changes); input.invalidateGraph(); });
	selectBehaviorLensDefinition(view, view.document.definitions[0].rowKey);
	const graph = view.presentation;
	if (graph.kind !== 'state-graph') throw new Error('Fixture must open the concrete FSM presentation');
	graph.viewport.layout(0, 0, 384, 288);
	const refresh = () => { installBehaviorLensDocument(view, document(), model.buffer); view.sourceVersion = model.version; input.updateGraph(font); };
	const settle = async () => { await input.graphLayout.settled; input.updateGraph(font); assert.equal(graph.layoutState.kind, 'ready'); };
	return { input, model, view, graph, refresh, settle };
}

test('FSM graph retains containment, concurrent entry and separate edges for identical returns in shared uses', async () => {
	const f = fixture();
	try {
		f.input.updateGraph(font);
		assert.equal(f.graph.layoutState.kind, 'pending');
		assert.equal(f.graph.viewport.model.nodes.length, 0);
		await f.settle();
		const model = f.graph.viewport.model;
		const root = model.nodes[0];
		assert.deepEqual(root.children.map(child => child.source.label), ['left', 'right']);
		const updates = model.edges.filter(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.transition.slot.kind === 'update');
		assert.equal(updates.length, 4);
		assert.equal(new Set(updates.map(edge => edge.link.reference)).size, 4);
		assert.equal(updates[0].link.source, updates[1].link.source);
		assert.notEqual(updates[0].link.source, updates[2].link.source);
		assert.notDeepEqual(updates[0].points, updates[1].points);
		assert.equal(model.edges.filter(edge => edge.link.reference.kind === 'state-entry' && edge.link.reference.entry.kind === 'concurrent').length, 2);
		for (const edge of model.edges) {
			assert.equal(edge.arrow.length, 6);
			f.graph.viewport.reveal(edge);
			const label = edge.labels[0].bounds;
			assert.equal(f.graph.viewport.hitTest(label.left + 2 - f.graph.viewport.scrollX, label.top + 2 - f.graph.viewport.scrollY), edge);
		}
		f.graph.viewport.selection = updates[3];
		acceptStateGraphSelection(f.view, f.graph, f.model.buffer);
		assert.equal(stateGraphSelection(model, f.view.selection), updates[3]);
		const retained = f.graph.viewport.model;
		for (let index = 0; index < 100; index += 1) f.input.updateGraph(font);
		assert.equal(f.graph.viewport.model, retained, 'idle frames do not project, measure or reroute');
	} finally { f.input.dispose(); }
});

test('FSM graph shows unknown/no-path evidence without endpoints and preserves source selection when its path becomes nil', async () => {
	const f = fixture();
	try {
		f.input.updateGraph(font); await f.settle();
		const edge = f.graph.viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.transition.slot.kind === 'update')!;
		f.graph.viewport.selection = edge;
		acceptStateGraphSelection(f.view, f.graph, f.model.buffer);
		const at = f.model.buffer.getText().indexOf("'../active'");
		f.model.pushEditOperations([{ offset: at, deleteLength: "'../active'".length, text: 'nil' }]);
		assert.equal(f.graph.viewport.model.nodes.length, 0, 'source edit immediately revokes old hit geometry, even while hidden');
		f.refresh(); await f.settle();
		assert.equal(f.view.selection?.kind, 'state-outcome');
		if (f.view.selection?.kind !== 'state-outcome') throw new Error('Selected proof missing');
		assert.equal(f.view.selection.outcome.target.kind, 'no-path');
		assert.equal(f.graph.viewport.selection, null, 'no invented self-loop or parent edge for return nil');
		assert.ok(f.graph.viewport.model.nodes.some(node => node.lines.some(line => line.includes('NO PATH'))));
		assert.ok(buildStateMachineDetails(f.view).some(detail => detail.detail.includes('NO RETURNED PATH')));
		f.model.undo(); f.refresh(); await f.settle();
		assert.equal(f.graph.viewport.selection?.kind, 'edge');
	} finally { f.input.dispose(); }
});

test('FSM graph handles root/parent handlers, cycles and self loops; unknown callbacks and guards remain source details', async () => {
	const f = fixture(`local fsm<const> = require('cartlib/fsm/library')
fsm.register('cyclic', { initial = 'a', on = { parent = '/a' }, states = {
 a = { update = callbacks.dynamic, transition_guards = { can_enter = guards.enter }, on = { self = '../a', go = '../b' } },
 b = { on = { back = '../a' } },
}})`);
	try {
		f.input.updateGraph(font); await f.settle();
		const model = f.graph.viewport.model;
		const root = model.nodes[0];
		for (const node of model.nodes) for (const coordinate of Object.values(node.bounds)) assert.equal(coordinate, Math.round(coordinate));
		for (const edge of model.edges) {
			for (const coordinate of edge.points) assert.equal(coordinate, Math.round(coordinate));
			for (const label of edge.labels) for (const coordinate of Object.values(label.bounds)) assert.equal(coordinate, Math.round(coordinate));
		}
		assert.equal(model.edges.length, 5, 'initial, parent handler, self loop and two cycle directions only');
		assert.ok(model.edges.some(edge => edge.link.source === edge.link.target));
		assert.equal(model.edges.filter(edge => edge.link.source === root).length, 2, 'parent handler is not cloned onto children');
		const a = root.children[0];
		assert.ok(a.lines.includes('GUARDS (SOURCE ONLY)'));
		assert.ok(a.lines.some(line => line.includes('1 UNKNOWN')));
		f.view.selection = { kind: 'node', rowKey: a.source.rowKey };
		const details = buildStateMachineDetails(f.view);
		assert.ok(details.some(detail => detail.label.startsWith('update = callbacks.dynamic')));
		assert.ok(details.some(detail => detail.label.includes('can_enter')));
		assert.ok(details.some(detail => detail.detail === 'UNRESOLVED: unknown-callback'));
	} finally { f.input.dispose(); }
});

class HeldEngine {
	public jobs: { graph: ElkNode; resolve: (graph: ElkNode) => void; reject: (error: Error) => void }[] = [];
	public disposed = false;
	public layout(graph: ElkNode): Promise<ElkNode> {
		return new Promise((resolve, reject) => this.jobs.push({ graph, resolve, reject }));
	}
	public dispose(): void { this.disposed = true; }
}

test('concrete input coalesces edits, hides stale geometry, publishes no obsolete proof and disposes its engine', async () => {
	const held = new HeldEngine();
	const real = new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs')));
	let creates = 0;
	const f = fixture(FSM_PROOF_SOURCE, () => { creates += 1; return held; });
	try {
		assert.equal(creates, 0, 'input construction is not engine startup');
		f.input.updateGraph(font);
		const old = held.jobs[0];
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
		f.refresh();
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- latest\n' }]);
		f.refresh();
		assert.equal(held.jobs.length, 1);
		old.resolve(await real.layout(old.graph));
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.equal(held.jobs.length, 2, 'only newest waiting generation measured and cloned');
		assert.equal(f.graph.viewport.model.nodes.length, 0, 'stale geometry cannot publish');
		const latest = held.jobs[1];
		latest.resolve(await real.layout(latest.graph));
		await f.settle();
		const reference = f.graph.viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!.link.reference;
		f.view.selection = selectStateMachineSource(reference, f.model.buffer);
		assert.ok(reference.kind === 'state-outcome' && reference.outcome.proof.kind === 'return' && reference.outcome.proof.statement.range.start.line >= 6);
		f.input.updateGraph(new Font({ variant: 'msx' }));
		assert.equal(f.graph.layoutState.kind, 'pending', 'font measurement starts a new unpublished generation');
		held.jobs[2].reject(new Error('deliberate layout failure'));
		await f.input.graphLayout.settled;
		f.input.updateGraph(f.graph.viewport.model.font);
		assert.equal(f.graph.layoutState.kind, 'failed');
		assert.equal(f.graph.viewport.model.nodes.length, 0);
		assert.equal(held.jobs.length, 3, 'failure never retries or selects another layout');
	} finally { f.input.dispose(); real.dispose(); }
	assert.equal(held.disposed, true);
});

test('ELK half-pixel labels become one integer canvas generation rather than per-renderer glyph positions', async () => {
	const real = new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs')));
	let output: ElkNode;
	const f = fixture(FSM_DIAGRAM_SOURCE, () => ({
		async layout(graph) { output = await real.layout(graph); return output; },
		dispose() { real.dispose(); },
	}));
	try {
		f.input.updateGraph(font); await f.settle();
		assert.ok(output.edges!.some(edge => edge.labels!.some(label => label.x! % 1 !== 0 || label.y! % 1 !== 0)),
			'this independent fixture must exercise actual fractional ELK label placement');
		for (const edge of f.graph.viewport.model.edges) {
			for (const label of edge.labels) for (const value of Object.values(label.bounds)) assert.equal(value % 1, 0);
			f.graph.viewport.reveal(edge);
			assert.equal(f.graph.viewport.scrollX % 1, 0);
			assert.equal(f.graph.viewport.scrollY % 1, 0);
		}
	} finally { f.input.dispose(); }
});
