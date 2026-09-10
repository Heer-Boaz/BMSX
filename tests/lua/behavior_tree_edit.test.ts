import assert from 'node:assert/strict';
import test from 'node:test';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { behaviorTreeMoveTarget } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { BT_ORDER_SOURCE } from '../helpers/behavior_order_fixture';
import { createBehaviorTreeEditFixture as fixture } from '../helpers/behavior_tree_edit_fixture';

test('BT reorder uses array membership, not lexical indices or descendant warning admission', t => {
	const f = fixture(t);
	f.select(1);
	const member = behaviorTreeMoveTarget(f.view, -1)!;
	assert.equal(member.index, 1);
	assert.equal(member.table.fields.indexOf(member.branch.entries[1].field), 2, 'named metadata is not a BT child');
	assert.equal(f.view.document.definitions[0].resolution, 'partial', 'opaque descendants do not disable authored reordering');
	f.move(-1);
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE.replace(
		"\t-- first documentation\n\tleaf, -- first inline\n\tnote = 'metadata is not a child',\n\t-- nested documentation 🐉\n\tnested; -- nested inline\n",
		"\t-- nested documentation 🐉\n\tnested; -- nested inline\n\t-- first documentation\n\tleaf, -- first inline\n\tnote = 'metadata is not a child',\n"));
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'nested');
	assert.equal(behaviorTreeMoveTarget(f.view, -1), undefined);
	assert.ok(behaviorTreeMoveTarget(f.view, 1));
	f.model.undo(); f.refresh();
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
	assert.equal(behaviorTreeMoveTarget(f.view, -1)!.index, 1);
});

test('moves preserve the selected occurrence, fully expanded subtrees, source links and ordinary document history', t => {
	const f = fixture(t, BT_ORDER_SOURCE, 1);
	f.select(1);
	const selected = f.viewport.selection!;
	assert.ok(selected.kind === 'node' && selected.children.length > 0);
	for (const direction of [-1, 1, 1] as const) f.move(direction);
	const moved = f.model.buffer.getText();
	for (const operation of [() => {}, () => f.model.undo(), () => f.model.undo(), () => f.model.undo(),
		() => f.model.redo(), () => f.model.redo(), () => f.model.redo()]) {
		operation(); f.refresh();
		assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey, 'shared initializer does not select the first registration');
		assert.ok(f.viewport.selection?.kind === 'node' && f.viewport.selection.children.length === 2);
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'nested');
	}
	assert.equal(f.model.buffer.getText(), moved);
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	prepareBehaviorLensLayout(f.view);
	assert.equal(readLuaSourceRange(f.model.buffer, f.viewport.model.nodes[0].children[0].children[2].source.occurrenceRange), 'nested',
		'editing a shared initializer changes every authored use, not a private copy of the selected occurrence');
});

test('choice node and edge commands move the complete weighted wrapper and retain their distinct selection roles', t => {
	for (const edge of [false, true]) {
		const f = fixture(t, BT_ORDER_SOURCE, 2);
		f.select(2, edge);
		assert.equal(behaviorTreeMoveTarget(f.view, 1), undefined);
		f.move(-1);
		assert.equal(f.viewport.selection!.kind, edge ? 'edge' : 'node');
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!),
			edge ? '{ weight = 3, child = make_node(3) }' : 'make_node(3)');
		assert.deepEqual(f.viewport.model.nodes[0].children[0].children.map(node => node.lines[0]),
			['CHOICE 1  W=1', 'CHOICE 2  W=3', 'CHOICE 3  W=9']);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE, 'Undo restores the absent final separator too');
		assert.equal(f.viewport.selection!.kind, edge ? 'edge' : 'node');
	}
});

test('identical subtree uses keep the explicitly moved occurrence, not the first namesake', t => {
	const f = fixture(t, BT_ORDER_SOURCE.replace('make_node(3) -- last inline', 'nested -- last inline'));
	f.select(2);
	f.move(-1);
	const children = f.viewport.model.nodes[0].children[0].children;
	assert.equal(children[1].source.authoredRange, children[2].source.authoredRange, 'two uses of the same initializer');
	assert.equal(f.viewport.selection, children[1]);
	assert.equal(children[1].children.length, 2);
	assert.equal(children[2].children.length, 2, 'the identical neighbour is fully visible without inheriting selection');
	f.model.undo(); f.refresh();
	assert.equal(f.viewport.selection, f.viewport.model.nodes[0].children[0].children[2]);
	assert.ok(f.viewport.selection?.kind === 'node' && f.viewport.selection.children.length === 2);
});

test('only complete syntax and proven list positions have move targets, never roots, parallel roles or unknown membership', t => {
	for (const root of [
		"{ type = 'sequence', children = build() }",
		"{ type = 'sequence', children = { [1] = leaf, leaf } }",
		"{ type = 'sequence', children = { [slot] = leaf, leaf } }",
		"{ type = 'simple_parallel', main_task = leaf, background_tree = leaf }",
	]) {
		const f = fixture(t, `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
trees.register('admission', { root = ${root} })`);
		for (const node of f.viewport.model.nodes) {
			f.viewport.selection = node;
			assert.equal(behaviorTreeMoveTarget(f.view, -1), undefined);
			assert.equal(behaviorTreeMoveTarget(f.view, 1), undefined);
		}
	}
	const f = fixture(t);
	f.select(1);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n@' }]);
	f.refresh();
	assert.equal(f.view.document.syntaxComplete, false);
	assert.equal(behaviorTreeMoveTarget(f.view, -1), undefined);
	f.model.undo(); f.refresh();
	assert.ok(behaviorTreeMoveTarget(f.view, -1));
	const retained = f.viewport.model;
	const target = behaviorTreeMoveTarget(f.view, -1);
	for (let index = 0; index < 1000; index += 1) {
		prepareBehaviorLensLayout(f.view);
		assert.equal(behaviorTreeMoveTarget(f.view, -1), target);
	}
	assert.equal(f.viewport.model, retained, 'warm admission returns retained provenance without reparse or graph work');
});

test('known list mutation is not admitted as an ordered source edit', t => {
	const f = fixture(t, BT_ORDER_SOURCE.replace('local root<const>', 'children[1] = nested\nlocal root<const>'));
	f.select(0);
	assert.equal(behaviorTreeMoveTarget(f.view, -1), undefined);
	assert.equal(behaviorTreeMoveTarget(f.view, 1), undefined);
	assert.ok(f.viewport.selection?.kind === 'node' && f.viewport.selection.lines[1] === '? PARTIAL MEMBERSHIP');
});
