import assert from 'node:assert/strict';
import test from 'node:test';
import { beginBehaviorTreeDrag } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_drag';
import type { BehaviorGraphNode } from '../../ide/workbench/contrib/behavior_lens/graph_model';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { BT_ORDER_SOURCE } from '../helpers/behavior_order_fixture';
import { createBehaviorTreeEditFixture as fixture } from '../helpers/behavior_tree_edit_fixture';

function over(f: ReturnType<typeof fixture>, node: BehaviorGraphNode, before: boolean) {
	return [node.bounds.left + (node.bounds.right - node.bounds.left) * (before ? 0.25 : 0.75) + f.viewport.bounds.left - f.viewport.scrollX,
		node.bounds.top + node.headerHeight / 2 + f.viewport.bounds.top - f.viewport.scrollY] as const;
}

test('every sibling insertion sector normalizes once, with no preview edit and one ordinary Undo', t => {
	for (let source = 0; source < 3; source += 1) {
		for (let target = 0; target < 3; target += 1) {
			for (const before of [true, false]) {
				const f = fixture(t);
				f.select(source);
				const originalGraph = f.viewport.model;
				const children = originalGraph.nodes[0].children[0].children;
				const originalEntries = children.map(node => readLuaSourceRange(f.model.buffer, node.source.occurrenceRange));
				const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer'))!;
				let changes = 0;
				f.model.onDidChangeContent(() => { changes += 1; });
				const insertion = target + (before ? 0 : 1);
				const destination = insertion > source ? insertion - 1 : insertion;
				drag.dragOver(...over(f, children[target], before));
				assert.equal(drag.feedback.accepted, source !== destination);
				assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
				assert.equal(f.model.canUndo, false);
				assert.equal(changes, 0);
				assert.equal(f.viewport.model, originalGraph);
				if (!drag.feedback.accepted) continue;
				drag.drop(); f.refresh();
				assert.equal(changes, 1);
				const expected = originalEntries.slice();
				expected.splice(destination, 0, ...expected.splice(source, 1));
				assert.deepEqual(f.viewport.model.nodes[0].children[0].children.map(node => readLuaSourceRange(f.model.buffer, node.source.occurrenceRange)), expected);
				assert.equal(f.viewport.selection?.kind, 'node');
				assert.equal(f.viewport.selection, f.viewport.model.nodes[0].children[0].children[destination]);
				f.model.undo(); f.refresh();
				assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
				assert.equal(f.model.canUndo, false);
				assert.equal(f.model.dirty, false);
			}
		}
	}
});

test('weighted cards and incoming routes drag the whole choice, not a detached child or weight', t => {
	for (const edge of [false, true]) {
		const f = fixture(t, BT_ORDER_SOURCE, 2);
		f.select(2, edge);
		const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer'))!;
		drag.dragOver(...over(f, f.viewport.model.nodes[0].children[0].children[0], true));
		assert.equal(drag.feedback.accepted, true);
		drag.drop(); f.refresh();
		assert.deepEqual(f.viewport.model.nodes[0].children[0].children.map(node => node.lines.find(line => line.startsWith('CHOICE'))), ['CHOICE  W=3', 'CHOICE  W=1', 'CHOICE  W=9']);
		assert.equal(f.viewport.selection!.kind, edge ? 'edge' : 'node');
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
	}
});

test('different parents use real source lists; unchanged shared positions, definition cards and routes are not targets', t => {
	const f = fixture(t, BT_ORDER_SOURCE.replace('make_node(3) -- last inline', 'nested -- last inline'));
	f.select(1);
	f.select(2);
	const children = f.viewport.model.nodes[0].children[0].children;
	f.viewport.selection = children[1].children[0];
	const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer'))!;
	for (const [node, accepted] of [[f.viewport.model.nodes[0], false], [children[0], true], [children[1], true], [children[2].children[1], false]] as const) {
		f.viewport.reveal(node);
		drag.dragOver(...over(f, node, true));
		assert.equal(drag.feedback.accepted, accepted);
	}
	const sibling = children[1].children[1];
	f.viewport.reveal(sibling);
	drag.dragOver(...over(f, sibling, false));
	assert.equal(drag.feedback.accepted, true);
	const edge = f.viewport.model.edges.find(edge => edge.child === sibling)!;
	drag.dragOver(edge.points[edge.points.length - 2] + f.viewport.bounds.left - f.viewport.scrollX,
		edge.points[edge.points.length - 1] - 6 + f.viewport.bounds.top - f.viewport.scrollY);
	assert.equal(drag.feedback.accepted, false, 'an old accepted card does not authorize dropping on its route');
	drag.dragOver(-10, -10);
	assert.equal(drag.feedback.accepted, false);
	assert.equal(f.model.dirty, false);
});

test('source generation and readonly invalidate an in-flight source payload independently of layout refresh', t => {
	const f = fixture(t);
	f.select(0);
	const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer'))!;
	assert.ok(drag.isCurrent());
	const resource = f.model.resource;
	f.model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	assert.equal(drag.isCurrent(), false);
	assert.equal(beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer')), undefined);
	f.model.refreshResource(resource);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n@' }]);
	assert.equal(drag.isCurrent(), false);
	assert.equal(beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer')), undefined, 'old syntax does not admit a new drag');
	f.refresh(); f.select(0);
	assert.equal(beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer')), undefined, 'recovered syntax is not an editable complete constructor');
});

test('unknown, keyed, mutated lists and parallel roles expose navigation but no drag source', t => {
	for (const source of [
		BT_ORDER_SOURCE.replace('children = children }', 'children = build() }'),
		BT_ORDER_SOURCE.replace("note = 'metadata is not a child'", '[1] = leaf'),
		BT_ORDER_SOURCE.replace("note = 'metadata is not a child'", '[slot] = leaf'),
		BT_ORDER_SOURCE.replace('local root<const>', 'children[1] = nested\nlocal root<const>'),
		BT_ORDER_SOURCE.replace("type = 'sequence', children = children", "type = 'simple_parallel', main_task = leaf, background_tree = leaf"),
	]) {
		const f = fixture(t, source);
		for (const node of f.viewport.model.nodes) {
			f.viewport.selection = node;
			assert.equal(beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer')), undefined);
		}
	}
});
