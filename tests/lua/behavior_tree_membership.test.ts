import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { layoutBehaviorTreeGraph } from '../../ide/workbench/contrib/behavior_lens/graph_geometry';
import { projectBehaviorTreeGraph } from '../../ide/workbench/contrib/behavior_lens/graph_projection';
import { readLuaSourceRange, luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { SourceTableIssue } from '../../ide/workbench/contrib/behavior_lens/source';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { installBehaviorLensDocument, prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { BT_MEMBERSHIP_SOURCE } from '../helpers/behavior_membership_fixture';

const font = new Font({ variant: 'tiny' });
function fixture(source = BT_MEMBERSHIP_SOURCE, index = 0) {
	const model = new EditorTextModel({ domain: 0, path: 'membership.lua', source: { type: 'lua', resid: 'membership' } }, 'lua', source);
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), model.resource.path));
	const document = project();
	const definition = document.definitions[index];
	assert.ok(definition.behaviorKind === 'behavior_tree');
	const graph = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(definition, new Set(), font));
	return { model, document, definition, graph, project, root: graph.nodes[0].children[0] };
}

test('opaque child values do not erase the proven surrounding child-list order', () => {
	const { model, definition, graph, root } = fixture();
	assert.equal(definition.resolution, 'partial', 'the complete subtree is not statically known');
	assert.deepEqual(root.children.map(child => child.lines[0]), ['CHILD 1', 'CHILD 2', 'CHILD 3', 'CHILD 4']);
	assert.deepEqual(root.children.map(child => child.source.kind), ['node', 'dynamic', 'node', 'dynamic']);
	assert.equal(root.children[1].children.length, 0, 'the builder is not evaluated in the host');
	assert.deepEqual(root.children[2].children[0].lines, ['CHILDREN', '? PARTIAL MEMBERSHIP'], 'uncertainty belongs to the nested list, not its parent');
	for (const child of root.children) {
		const edge = graph.edgesBySource.get(child.source.rowKey)!;
		assert.equal(edge.child, child);
		assert.deepEqual(edge.range, child.source.occurrenceRange);
	}
	assert.equal(readLuaSourceRange(model.buffer, graph.edgesBySource.get(root.children[3].source.rowKey)!.range), 'make_node()');
});

test('opaque choices and choice-child values retain their ordered slots and independent source roles', () => {
	const { model, definition, graph, root } = fixture(BT_MEMBERSHIP_SOURCE, 2);
	assert.equal(definition.resolution, 'partial');
	assert.deepEqual(root.children.map(child => child.lines[0]), ['CHOICE 1  W=2', 'CHOICE 2', 'CHOICE 3  W=4', 'CHOICE 4  W=5']);
	assert.deepEqual(root.children.map(child => child.source.kind), ['node', 'dynamic', 'dynamic', 'node']);
	const branch = definition.root;
	assert.ok(branch?.kind === 'node' && branch.branches[0].role === 'choices');
	for (const entry of branch.branches[0].entries) {
		const edge = graph.edgesBySource.get(entry.node.rowKey)!;
		assert.equal(edge.source, entry.node);
		assert.equal(edge.range, entry.field.value.range);
	}
	const third = root.children[2];
	const thirdEdge = graph.edgesBySource.get(branch.branches[0].entries[2].node.rowKey)!;
	assert.equal(readLuaSourceRange(model.buffer, third.source.occurrenceRange), 'make_node()');
	assert.equal(readLuaSourceRange(model.buffer, thirdEdge.range), '{ weight = 4, child = make_node() }');
	assert.equal(readLuaSourceRange(model.buffer, third.details.find(detail => detail.label === 'weight')!.range), '4');
});

test('BT lists retain their actual constructor and local issues separately from aggregate source warnings', () => {
	const { definition, document } = fixture();
	const other = document.definitions[1];
	assert.ok(definition.root?.kind === 'node' && other.behaviorKind === 'behavior_tree' && other.root?.kind === 'node');
	const first = definition.root.branches[0];
	const second = other.root.branches[0];
	assert.ok(first.role === 'children' && second.role === 'children');
	assert.ok(first.source.kind === 'section' && second.source.kind === 'section');
	assert.equal(first.source.resolution, 'partial');
	assert.equal(first.source.issues, SourceTableIssue.None);
	assert.equal(first.source.table, second.source.table, 'one authored list, two independent occurrences');
	assert.notEqual(first.source, second.source);
	assert.deepEqual(first.entries.map(entry => entry.index), [1, 2, 3, 4]);
	for (let index = 0; index < first.entries.length; index += 1) {
		assert.equal(first.entries[index].field, first.source.table.fields[index]);
		assert.equal(first.entries[index].node, first.source.children[index]);
		assert.notEqual(first.entries[index].node.rowKey, second.entries[index].node.rowKey);
	}
	const weighted = fixture(BT_MEMBERSHIP_SOURCE, 2).definition.root;
	assert.ok(weighted?.kind === 'node' && weighted.branches[0].role === 'choices');
	const choices = weighted.branches[0];
	assert.ok(choices.source.kind === 'section');
	assert.equal(choices.source.issues, SourceTableIssue.None);
	assert.equal(choices.source.resolution, 'partial');
	const choice = choices.entries[2].node;
	assert.ok(choice.kind === 'section');
	assert.equal(choice.issues, SourceTableIssue.None, 'opaque child does not taint the weight/child wrapper');
	assert.equal(choice.resolution, 'partial');
});

test('unknown, keyed and mutated membership still has no guessed dense edges', () => {
	for (const role of ['children', 'choices']) {
		const type = role === 'children' ? 'sequence' : 'weighted_random_selector';
		const member = role === 'children' ? "{ type = 'wait' }" : "{ weight = 1, child = { type = 'wait' } }";
		for (const [expression, mutation, issues] of [
			['make_list()', '', null],
			[`{ ${member}, [4] = ${member} }`, '', SourceTableIssue.NumericKey],
			[`{ ${member}, [slot] = ${member} }`, '', SourceTableIssue.ComputedKey],
			[`{ ${member}, ${member} }`, `alias[1] = ${member}`, SourceTableIssue.KnownMutation],
		] as const) {
			const { definition, root } = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
local list<const> = ${expression}
local alias<const> = list
${mutation}
trees.register('unknown-list', { root = { type = '${type}', ${role} = alias } })`);
			assert.equal(root.children.length, 1);
			assert.deepEqual(root.children[0].lines, [role.toUpperCase(), '? PARTIAL MEMBERSHIP']);
			assert.ok(definition.root?.kind === 'node');
			const branch = definition.root.branches[0];
			assert.ok(branch.role === 'children' || branch.role === 'choices');
			if (issues === null) assert.equal(branch.source.kind, 'dynamic');
			else {
				assert.ok(branch.source.kind === 'section');
				assert.equal(branch.source.issues, issues);
				assert.ok(branch.entries.every(entry => entry.index === null));
			}
		}
		const empty = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('empty', { root = { type = '${type}', ${role} = {} } })`);
		assert.equal(empty.root.children.length, 0, 'proven empty list differs from unresolved membership');
	}
});

test('attachment counts describe known slots even when an attachment is opaque or incomplete', () => {
	const { model, root } = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('attachments', { root = {
	type = 'sequence', children = { { type = 'wait' }, opaque_node() },
	services = { { service = actions.scan }, opaque_service(), { interval = 7 } },
	decorators = { opaque_decorator(), { type = 'loop', num_loops = 3 } },
} })`);
	assert.ok(root.lines.includes('SVC 3') && root.lines.includes('DEC 2'));
	assert.equal(root.children.length, 2, 'attachments are details, not execution children');
	assert.ok(root.details.some(detail => detail.description === 'actions.scan' && detail.detail === 'SVC 1'));
	assert.ok(root.details.some(detail => readLuaSourceRange(model.buffer, detail.range) === 'opaque_service()'));
	assert.ok(root.details.some(detail => detail.label === 'interval' && detail.detail === 'SVC 3'));
	assert.ok(root.details.some(detail => readLuaSourceRange(model.buffer, detail.range) === 'opaque_decorator()'));
	assert.ok(root.details.some(detail => detail.label === 'num_loops' && detail.detail === 'DEC 2'));
});

test('nested membership warnings, shared occurrences, hidden edits and Undo use existing source correspondence', t => {
	const previous = { font: editorViewState.font, viewportWidth: editorViewState.viewportWidth, viewportHeight: editorViewState.viewportHeight,
		lineHeight: editorViewState.lineHeight, codeAreaTop: editorViewState.codeAreaTop, codeAreaBottom: editorViewState.codeAreaBottom };
	t.after(() => Object.assign(editorViewState, previous));
	Object.assign(editorViewState, { font: new EditorFont('tiny'), viewportWidth: 384, viewportHeight: 288, lineHeight: 6, codeAreaTop: 24, codeAreaBottom: 276 });
	const f = fixture();
	const view = createBehaviorLensViewState(f.document, f.model, 'graph');
	f.model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, event.changes));
	selectBehaviorLensDefinition(view, f.document.definitions[1].rowKey);
	prepareBehaviorLensLayout(view);
	assert.ok(view.presentation.kind === 'graph');
	const viewport = view.presentation.viewport;
	const nested = viewport.model.nodes[0].children[0].children[2];
	viewport.selection = viewport.model.edgesBySource.get(nested.source.rowKey)!;
	acceptBehaviorGraphSelection(view, view.presentation);
	const hidden = view.document;
	const second = f.definition.root;
	assert.ok(second?.kind === 'node' && second.branches[0].role === 'children');
	const span = luaSourceRangeToTextRange(f.model.buffer, second.branches[0].entries[1].field.range);
	f.model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: 'leaf' }]);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 shifted source\n' }]);
	assert.equal(view.document, hidden);
	const refresh = () => { installBehaviorLensDocument(view, f.project(), f.model.buffer); prepareBehaviorLensLayout(view); };
	refresh();
	assert.equal(view.definitionRowKey, view.document.definitions[1].rowKey);
	assert.ok(viewport.selection?.kind === 'edge');
	assert.equal(viewport.selection.child.lines[0], 'CHILD 3');
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(view)!), 'nested');
	const retained = viewport.model;
	for (let index = 0; index < 100; index += 1) prepareBehaviorLensLayout(view);
	assert.equal(viewport.model, retained, 'warnings introduce no warm layout work');
	f.model.undo();
	f.model.undo();
	refresh();
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(view)!), 'nested');
	const table = f.model.buffer.getText().indexOf('{ leaf, make_node(), nested, make_node() }');
	f.model.pushEditOperations([{ offset: table + 1, deleteLength: 0, text: ' [slot] = leaf,' }]);
	refresh();
	assert.equal(view.selection, null, 'unknown membership revokes the selected ordered edge');
	assert.equal(viewport.model.nodes[0].children[0].children.length, 1);
	f.model.undo();
	refresh();
	assert.equal(view.selection, null, 'Undo does not invent revoked source selection');
	assert.equal(viewport.model.nodes[0].children[0].children.length, 4);
	assert.equal(f.model.buffer.getText(), BT_MEMBERSHIP_SOURCE);
});
