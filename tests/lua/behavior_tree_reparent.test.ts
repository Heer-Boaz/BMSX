import assert from 'node:assert/strict';
import test from 'node:test';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { beginBehaviorTreeDrag, type BehaviorTreeTransferDrop } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_drag';
import { transferBehaviorTreeChild } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { behaviorTreeTransferImpacts } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_review';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import type { BehaviorGraphNode } from '../../ide/workbench/contrib/behavior_lens/graph_model';
import { BT_REPARENT_SOURCE } from '../helpers/behavior_reparent_fixture';
import { createBehaviorTreeEditFixture as fixture } from '../helpers/behavior_tree_edit_fixture';

function targetPoint(f: ReturnType<typeof fixture>, node: BehaviorGraphNode, placement: 'before' | 'after' | 'inside') {
	f.viewport.reveal(node);
	return [f.viewport.graphToViewportX(node.bounds.left + (node.bounds.right - node.bounds.left) * (placement === 'before' ? 0.2 : placement === 'after' ? 0.8 : 0.5)),
		f.viewport.graphToViewportY(node.bounds.top + node.headerHeight / 2)] as const;
}

test('a drop into deeper and empty parents proposes source, then one Undo/Redo preserves the moved occurrence', t => {
	for (const targetIndex of [1, 2]) for (const edge of [false, true]) {
		const f = fixture(t, BT_REPARENT_SOURCE);
		f.select(0, edge);
		const root = () => f.viewport.model.nodes[0].children[0];
		let proposal: Parameters<BehaviorTreeTransferDrop> | undefined;
		const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, (...drop) => { proposal = drop; })!;
		drag.dragOver(...targetPoint(f, root().children[targetIndex], 'inside'));
		assert.equal(drag.feedback.accepted, true);
		assert.equal(drag.feedback.kind, 'node-insertion');
		if (drag.feedback.kind === 'node-insertion') assert.equal(drag.feedback.placement, 'inside');
		drag.drop();
		assert.equal(f.model.canUndo, false, 'drop only requests review');
		assert.equal(f.model.buffer.getText(), BT_REPARENT_SOURCE);
		const [analysis, insertion, check] = proposal!;
		const impacts = behaviorTreeTransferImpacts(f.view, analysis, insertion, check);
		assert.ok(impacts.some(item => item.label === 'POTENTIAL read'.toUpperCase() && item.value === 'leaf'));
		assert.ok(impacts.every(item => item.range.path === f.model.resource.path));
		transferBehaviorTreeChild(f.model, f.view, analysis.member, check, insertion);
		f.refresh();
		const destination = root().children[targetIndex - 1];
		const moved = destination.children[destination.children.length - 1];
		assert.equal(f.viewport.selection?.kind, edge ? 'edge' : 'node');
		assert.equal(f.viewport.selection?.kind === 'edge' ? f.viewport.selection.child : f.viewport.selection, moved);
		assert.equal(readLuaSourceRange(f.model.buffer, moved.source.occurrenceRange), 'leaf');
		assert.equal(root().children.length, 2);
		const text = f.model.buffer.getText();
		assert.match(text, /traveller documentation\n\s*leaf, -- traveller inline/);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_REPARENT_SOURCE);
		assert.equal(f.model.dirty, false);
		assert.equal(f.model.canUndo, false);
		assert.equal(f.viewport.selection?.kind === 'edge' ? f.viewport.selection.child : f.viewport.selection, root().children[0]);
		f.model.redo(); f.refresh();
		assert.equal(f.model.buffer.getText(), text);
		assert.equal(f.viewport.selection?.kind === 'edge' ? f.viewport.selection.child : f.viewport.selection,
			root().children[targetIndex - 1].children.at(-1));
	}
});

test('an only child moves upward before a sibling and leaves its written list empty', t => {
	const f = fixture(t, BT_REPARENT_SOURCE);
	const root = () => f.viewport.model.nodes[0].children[0];
	f.viewport.selection = root().children[1].children[0].children[0];
	acceptBehaviorGraphSelection(f.view, f.graph);
	const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, (analysis, insertion, check) => {
		transferBehaviorTreeChild(f.model, f.view, analysis.member, check, insertion);
	})!;
	drag.dragOver(...targetPoint(f, root().children[2], 'before'));
	assert.equal(drag.feedback.accepted, true);
	drag.drop(); f.refresh();
	assert.equal(root().children.length, 4);
	assert.equal(root().children[1].children[0].children.length, 0);
	assert.equal(f.viewport.selection, root().children[2]);
	f.model.undo(); f.refresh();
	assert.equal(f.model.buffer.getText(), BT_REPARENT_SOURCE);
	assert.equal(f.viewport.selection, root().children[1].children[0].children[0]);
});

test('weighted transfer keeps the wrapper, child selection, weight and comments together', t => {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type='wait',duration_ticks=3 }
trees.register('weighted', { root={type='sequence',children={
 {type='weighted_random_selector',choices={ {weight=9,child=leaf} }},
 {type='weighted_random_selector',choices={}},
}}})`;
	for (const edge of [false, true]) {
		const f = fixture(t, source);
		const root = () => f.viewport.model.nodes[0].children[0];
		const node = root().children[0].children[0];
		f.viewport.selection = edge ? f.viewport.model.edges.find(edge => edge.child === node)! : node;
		acceptBehaviorGraphSelection(f.view, f.graph);
		const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, (analysis, insertion, check) => {
			assert.ok(behaviorTreeTransferImpacts(f.view, analysis, insertion, check).some(item => item.label === 'EMPTY RANDOM SELECTOR'));
			transferBehaviorTreeChild(f.model, f.view, analysis.member, check, insertion);
		})!;
		drag.dragOver(...targetPoint(f, root().children[1], 'inside'));
		assert.equal(drag.feedback.accepted, true);
		drag.drop(); f.refresh();
		const selected = f.viewport.selection!;
		assert.equal(selected.kind, edge ? 'edge' : 'node');
		assert.equal(selected.kind === 'edge' ? selected.child : selected, root().children[1].children[0]);
		assert.ok(root().children[1].children[0].lines.includes('CHOICE  W=9'));
		assert.equal(root().children[0].children.length, 0);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), source);
	}
});

test('center sectors do not fabricate lists, replace roots or permit a descendant cycle', t => {
	const f = fixture(t, BT_REPARENT_SOURCE);
	f.select(1);
	const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, () => assert.fail('unexpected list transfer'))!;
	const root = f.viewport.model.nodes[0].children[0];
	for (const node of [root.children[0], root.children[1], root.children[1].children[0], f.viewport.model.nodes[0]]) {
		drag.dragOver(...targetPoint(f, node, 'inside'));
		assert.equal(drag.feedback.accepted, false);
	}
	assert.equal(f.model.canUndo, false);
});

test('a shared source list changes all its recognized uses but Undo selects the chosen occurrence', t => {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = {type='wait',duration_ticks=2}
local shared<const> = {type='sequence',children={leaf}}
trees.register('shared', {root={type='sequence',children={shared,shared,{type='selector',children={}}}}})`;
	const f = fixture(t, source);
	const root = () => f.viewport.model.nodes[0].children[0];
	f.viewport.selection = root().children[1].children[0];
	acceptBehaviorGraphSelection(f.view, f.graph);
	const drag = beginBehaviorTreeDrag(f.model, f.view, f.analysis, (analysis, insertion, check) => {
		assert.equal(analysis.sourceUses.length, 2);
		const impacts = behaviorTreeTransferImpacts(f.view, analysis, insertion, check);
		assert.equal(impacts.filter(item => item.label.startsWith('REMOVE FROM')).length, 2);
		transferBehaviorTreeChild(f.model, f.view, analysis.member, check, insertion);
	})!;
	drag.dragOver(...targetPoint(f, root().children[2], 'inside'));
	assert.equal(drag.feedback.accepted, true);
	drag.drop(); f.refresh();
	assert.equal(root().children[0].children.length, 0);
	assert.equal(root().children[1].children.length, 0);
	assert.equal(f.viewport.selection, root().children[2].children[0]);
	f.model.undo(); f.refresh();
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.viewport.selection, root().children[1].children[0]);
});
