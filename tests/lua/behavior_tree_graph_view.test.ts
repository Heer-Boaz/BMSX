import { layoutBehaviorTreeGraph } from '../../ide/workbench/contrib/behavior_lens/graph_geometry';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { selectBehaviorLensDefinition, prepareBehaviorLensLayout, installBehaviorLensDocument } from '../../ide/workbench/contrib/behavior_lens/layout';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { projectBehaviorTreeGraph } from '../../ide/workbench/contrib/behavior_lens/graph_projection';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { executeBehaviorLensNavigation, finishBehaviorLensNavigation, selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { readLuaSourceRange, luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { BEHAVIOR_SOURCE_FIXTURE } from '../helpers/behavior_source_fixture';

const font = new Font({ variant: 'tiny' });
function fixture(source = BEHAVIOR_SOURCE_FIXTURE) {
	const model = new EditorTextModel({ domain: 0, path: 'bt.lua', source: { type: 'lua', resid: 'bt' } }, 'lua', source);
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), 'bt.lua'));
	const document = project();
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'behavior_tree');
	return { model, document, definition, project };
}

test('graph projects one registration, original child order, distinct shared uses and typed attachment details', () => {
	const f = fixture();
	const graph = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(f.definition, new Set(), font));
	const root = graph.nodes[0];
	assert.equal(root.source, f.definition);
	assert.equal(root.children.length, 1, 'blackboard is a detail, not a control-flow child');
	const sequence = root.children[0];
	assert.equal(graph.edgesBySource.get(sequence.source.rowKey)!.points.length, 4, 'a straight connection has no degenerate bends');
	assert.equal(sequence.children.length, 3);
	assert.deepEqual(sequence.children.map(child => child.lines[0]), ['CHILD 1', 'CHILD 2', 'CHILD 3']);
	const [first, second, weighted] = sequence.children;
	assert.equal(first.source.authoredRange, second.source.authoredRange);
	assert.notEqual(first.source.rowKey, second.source.rowKey);
	assert.ok(first.lines.includes('SHARED') && second.lines.includes('SHARED'));
	assert.equal(graph.nodesBySource.size, graph.nodes.length);
	assert.equal(graph.edges.length, graph.nodes.length - 1);
	assert.ok(sequence.details.some(detail => detail.description === 'services.scan'));
	assert.ok(sequence.details.some(detail => detail.label === 'num_loops' && detail.description === '2'));
	assert.ok(root.details.some(detail => detail.label.startsWith('seen =')));
	assert.equal(weighted.children[0].lines[0], 'CHOICE 1  W=2');
	assert.equal(weighted.children[1].lines[0], 'CHOICE 2  W=WEIGHTS.RETREAT');
	const weight = weighted.children[1].details.find(detail => detail.label === 'weight')!;
	assert.equal(readLuaSourceRange(f.model.buffer, weight.range), 'weights.retreat');
	for (const child of sequence.children) {
		const edge = graph.edgesBySource.get(child.source.rowKey)!;
		assert.equal(edge.child, child);
		assert.equal(edge.range, child.source.occurrenceRange);
		assert.ok(edge.points[1] >= sequence.bounds.bottom);
	}
	for (const edge of graph.edges) assert.deepEqual(edge.range, edge.source.occurrenceRange, 'tree connections use their source occurrence, independent of geometry');
	assert.notDeepEqual(graph.edgesBySource.get(first.source.rowKey)!.range, graph.edgesBySource.get(second.source.rowKey)!.range);
});

test('collapse hides only one occurrence, and dynamic membership never becomes guessed ordered edges', () => {
	const f = fixture();
	const full = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(f.definition, new Set(), font));
	const [first, second] = full.nodes[0].children[0].children;
	const folded = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(f.definition, new Set([first.source.rowKey]), font));
	assert.equal(folded.nodesBySource.get(first.source.rowKey)!.children.length, 0);
	assert.equal(folded.nodesBySource.get(second.source.rowKey)!.children.length, 2);
	const dynamic = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('partial', { root = { type = 'sequence', children = { { type = 'wait' }, [key] = make_node() } } })`);
	const graph = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(dynamic.definition, new Set(), font));
	assert.equal(graph.nodes.length, 3);
	assert.deepEqual(graph.nodes[0].children[0].children[0].lines, ['CHILDREN', '? PARTIAL MEMBERSHIP']);
	assert.ok(graph.nodes[2].details.some(detail => readLuaSourceRange(dynamic.model.buffer, detail.range).includes('[key] = make_node()')));
});

test('parallel roles stay distinct; incidental fields and an unresolved root do not invent control flow', () => {
	const f = fixture();
	const parallel = f.document.definitions[1];
	assert.ok(parallel.behaviorKind === 'behavior_tree');
	const graph = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(parallel, new Set(), font));
	assert.deepEqual(graph.nodes[0].children[0].children.map(child => child.lines[0]), ['MAIN_TASK', 'BACKGROUND_TREE']);
	const incidental = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('leaf', { root = { type = 'wait', children = { { type = 'wait' } } } })`);
	assert.equal(layoutBehaviorTreeGraph(projectBehaviorTreeGraph(incidental.definition, new Set(), font)).nodes.length, 2);
	const dynamic = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')\ntrees.register('opaque', make_tree())`);
	const opaque = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(dynamic.definition, new Set(), font));
	assert.equal(opaque.nodes.length, 1);
	assert.equal(opaque.edges.length, 0);
	assert.ok(opaque.nodes[0].lines.includes('? NO STATIC ROOT'));
});

test('concrete graph retains layout, source-backed edge selection and its screen anchor through edits', t => {
	const previous = { font: editorViewState.font, viewportWidth: editorViewState.viewportWidth, viewportHeight: editorViewState.viewportHeight,
		lineHeight: editorViewState.lineHeight, codeAreaTop: editorViewState.codeAreaTop, codeAreaBottom: editorViewState.codeAreaBottom };
	t.after(() => Object.assign(editorViewState, previous));
	Object.assign(editorViewState, { font: new EditorFont('tiny'), viewportWidth: 384, viewportHeight: 288, lineHeight: 6, codeAreaTop: 24, codeAreaBottom: 276 });
	const f = fixture();
	const view = createBehaviorLensViewState(f.document, f.model, 'graph');
	f.model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, event.changes));
	selectBehaviorLensDefinition(view, f.definition.rowKey);
	prepareBehaviorLensLayout(view);
	assert.equal(view.presentation.kind, 'graph');
	assert.ok(view.presentation.kind === 'graph');
	const graph = view.presentation;
	const viewport = graph.viewport;
	assert.ok(!('rows' in graph), 'graph must not retain or navigate an invisible outline');
	const initial = viewport.model;
	for (let index = 0; index < 100; index += 1) prepareBehaviorLensLayout(view);
	assert.equal(viewport.model, initial);
	executeBehaviorLensNavigation(view, 'down');
	executeBehaviorLensNavigation(view, 'down');
	executeBehaviorLensNavigation(view, 'right');
	finishBehaviorLensNavigation(view);
	const selected = viewport.selection;
	assert.ok(selected?.kind === 'node' && selected.lines[0] === 'CHILD 2');
	const edge = viewport.model.edgesBySource.get(selected.source.rowKey)!;
	viewport.selection = edge;
	acceptBehaviorGraphSelection(view, graph);
	assert.equal(selectedBehaviorLensSourceRange(view), edge.range);
	const screenX = edge.bounds.left - viewport.scrollX;
	const screenY = edge.bounds.top - viewport.scrollY;
	const insertion = luaSourceRangeToTextRange(f.model.buffer, initial.nodes[0].children[0].children[0].source.occurrenceRange);
	f.model.pushEditOperations([{ offset: insertion.start, deleteLength: 0, text: "{ type = 'wait' }, " }]);
	installBehaviorLensDocument(view, f.project(), f.model.buffer);
	prepareBehaviorLensLayout(view);
	assert.ok(viewport.selection?.kind === 'edge');
	assert.notEqual(viewport.selection, edge);
	assert.equal(viewport.selection.child.lines[0], 'CHILD 3');
	assert.equal(viewport.selection.bounds.left - viewport.scrollX, screenX);
	assert.equal(viewport.selection.bounds.top - viewport.scrollY, screenY);
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(view)!), 'shared');
	const span = luaSourceRangeToTextRange(f.model.buffer, viewport.selection.range);
	f.model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: 'leaf' }]);
	installBehaviorLensDocument(view, f.project(), f.model.buffer);
	prepareBehaviorLensLayout(view);
	assert.equal(view.selection, null);
	assert.equal(viewport.selection, null);
	const secondDefinition = view.document.definitions[1];
	selectBehaviorLensDefinition(view, secondDefinition.rowKey);
	prepareBehaviorLensLayout(view);
	assert.equal(view.presentation, graph, 'another registration updates the retained graph presentation');
	assert.equal(graph.viewport, viewport, 'input-owned viewport survives an explicit topic change');
	assert.equal(viewport.selection, viewport.model.nodes[0]);
	assert.equal(viewport.model.nodes[0].source, secondDefinition);
	viewport.pan(1000, 1000);
	executeBehaviorLensNavigation(view, 'home');
	finishBehaviorLensNavigation(view);
	assert.ok(viewport.intersects(viewport.model.nodes[0].bounds, 0), 'Home reveals an already selected root after panning');
});

test('a weighted connection owns the choice use, not the shared choice initializer or its child use', () => {
	const f = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait' }
local choice<const> = { weight = 2, child = leaf }
trees.register('choices', { root = { type = 'weighted_random_selector', choices = { choice, choice } } })`);
	const root = f.definition.root;
	assert.ok(root?.kind === 'node');
	const branch = root.branches[0];
	assert.ok(branch.role === 'choices');
	const model = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(f.definition, new Set(), font));
	const [first, second] = branch.entries;
	const a = model.edgesBySource.get(first.node.rowKey)!;
	const b = model.edgesBySource.get(second.node.rowKey)!;
	assert.equal(a.source, first.node);
	assert.equal(b.source, second.node);
	assert.equal(a.range, first.field.value.range);
	assert.equal(b.range, second.field.value.range);
	assert.deepEqual(a.range, a.source.occurrenceRange);
	assert.deepEqual(b.range, b.source.occurrenceRange);
	assert.equal(readLuaSourceRange(f.model.buffer, a.range), 'choice');
	assert.equal(readLuaSourceRange(f.model.buffer, b.range), 'choice');
	assert.notEqual(a.range.start.column, b.range.start.column);
	assert.equal(a.child.source.authoredRange, b.child.source.authoredRange);
	assert.deepEqual(a.child.source.occurrenceRange, b.child.source.occurrenceRange);
});
