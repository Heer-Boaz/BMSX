import assert from 'node:assert/strict';
import test from 'node:test';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { behaviorTreeEditTarget, removeBehaviorTreeChild } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { createBehaviorLensOutline } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { BT_ORDER_SOURCE } from '../helpers/behavior_order_fixture';
import { createBehaviorTreeEditFixture as fixture } from '../helpers/behavior_tree_edit_fixture';

test('syntax recovery blocks deletion without discarding recognized weighted topology or its selection', t => {
	const f = fixture(t, BT_ORDER_SOURCE, 2);
	f.select(1, true);
	const selected = f.view.selection!.rowKey;
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n@' }]);
	f.refresh();
	assert.equal(f.view.document.syntaxComplete, false);
	assert.equal(behaviorTreeEditTarget(f.view), null);
	assert.equal(f.view.selection?.rowKey, selected);
	assert.equal(f.viewport.selection?.kind, 'edge');
	f.model.undo(); f.refresh();
	assert.equal(f.view.selection?.rowKey, selected);
	assert.equal(f.viewport.selection?.kind, 'edge');
	const member = behaviorTreeEditTarget(f.view)!;
	assert.equal(readLuaSourceRange(f.model.buffer, member.branch.entries[member.index].field.range), '{ weight = 9, child = nested }');
});

test('BT removal deletes the selected source field, preserving initializers, metadata and exterior trivia', t => {
	for (const [index, field, expected] of [
		[0, 'leaf', BT_ORDER_SOURCE.replace('\tleaf, -- first inline', '\t -- first inline')],
		[1, 'nested', BT_ORDER_SOURCE.replace('\tnested; -- nested inline', '\t -- nested inline')],
		[2, 'make_node(3)', BT_ORDER_SOURCE.replace('\tmake_node(3) -- last inline', '\t -- last inline')],
	] as const) {
		const f = fixture(t);
		f.select(index);
		const member = behaviorTreeEditTarget(f.view)!;
		assert.equal(readLuaSourceRange(f.model.buffer, member.branch.entries[member.index].field.range), field);
		assert.equal(member.table.fields.length, 4, 'named metadata is not a child rank');
		let events = 0;
		f.model.onDidChangeContent(() => { events += 1; });
		removeBehaviorTreeChild(f.model, member);
		assert.equal(events, 1, 'field and separator share one content event');
		assert.equal(f.model.buffer.getText(), expected);
		assert.equal(f.model.dirty, true);
		f.refresh();
		assert.equal(f.view.document.syntaxComplete, true);
		assert.equal(f.viewport.model.nodes[0].children[0].children.length, 2);
		assert.equal(f.view.definitionRowKey, f.view.document.definitions[0].rowKey);
		assert.equal(f.view.selection, null);
		assert.equal(f.viewport.selection, null);
		assert.equal(selectedBehaviorLensSourceRange(f.view), null);
		assert.equal(behaviorTreeEditTarget(f.view), null, 'a held Delete cannot consume the next child');
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE, 'Undo restores all syntax and separators byte-for-byte');
		assert.equal(f.model.canUndo, false, 'one normal Undo record');
		assert.equal(f.model.dirty, false);
		assert.equal(f.viewport.selection, null, 'Undo is not a second graph-selection history');
		f.model.redo(); f.refresh();
		assert.equal(f.model.buffer.getText(), expected);
		assert.equal(f.view.selection, null);
	}
});

test('weighted node and edge removal delete the complete choice, never just the child expression', t => {
	for (const edge of [false, true]) {
		const f = fixture(t, BT_ORDER_SOURCE, 2);
		f.select(1, edge);
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!),
			edge ? '{ weight = 9, child = nested }' : 'nested');
		removeBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
		f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE.replace('\t{ weight = 9, child = nested },', '\t'));
		assert.deepEqual(f.viewport.model.nodes[0].children[0].children.map(node => node.lines.find(line => line.startsWith('CHOICE'))), ['CHOICE  W=1', 'CHOICE  W=3']);
		assert.equal(f.viewport.selection, null);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
		assert.equal(f.viewport.selection, null);
	}
});

test('shared list edits update all occurrences but keep the chosen registration; namesakes never inherit selection', t => {
	const source = BT_ORDER_SOURCE.replace('make_node(3) -- last inline', 'nested -- last inline');
	const f = fixture(t, source, 1);
	f.select(1);
	removeBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
	f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
	assert.equal(f.viewport.selection, null);
	const survivor = f.viewport.model.nodes[0].children[0].children[1];
	assert.equal(readLuaSourceRange(f.model.buffer, survivor.source.occurrenceRange), 'nested');
	assert.equal(survivor.children.length, 2, 'the survivor is fully visible without inheriting selection');
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	prepareBehaviorLensLayout(f.view);
	assert.equal(f.viewport.model.nodes[0].children[0].children.length, 2, 'shared constructor is edited once, not privately copied');
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[2].rowKey);
	prepareBehaviorLensLayout(f.view);
	assert.equal(f.viewport.model.nodes[0].children[0].children.length, 3, 'referenced nested initializer remains available to the weighted tree');
	f.model.undo(); f.refresh();
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[2].rowKey, 'Undo does not reopen the formerly selected registration');
});

test('deleting a child inside a shared initializer edits that one constructor, not an occurrence copy', t => {
	const f = fixture(t);
	f.select(1);
	const nested = f.viewport.selection!;
	assert.ok(nested.kind === 'node');
	f.viewport.selection = nested.children[0];
	acceptBehaviorGraphSelection(f.view, f.graph);
	removeBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
	f.refresh();
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE.replace('children = { leaf, make_node(2) }', 'children = {  make_node(2) }'));
	assert.equal(f.viewport.selection, null);
	for (const definition of f.view.document.definitions) {
		selectBehaviorLensDefinition(f.view, definition.rowKey);
		prepareBehaviorLensLayout(f.view);
		f.select(1);
		const node = f.viewport.selection!;
		assert.ok(node.kind === 'node');

		assert.ok(f.viewport.selection?.kind === 'node');
		assert.equal(f.viewport.selection.children.length, 1);
		assert.equal(readLuaSourceRange(f.model.buffer, f.viewport.selection.children[0].source.occurrenceRange), 'make_node(2)');
	}
});

test('sole children and opaque choices can be removed without deleting their table or inventing a runtime substitute', t => {
	for (const [nodeType, fields] of [
		['sequence', 'children = { leaf }'],
		['weighted_random_selector', 'choices = { build_choice() }'],
		['weighted_random_selector', 'choices = { { weight = 2, child = leaf }; }'],
	]) {
		const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
trees.register('sole', { root = { type = '${nodeType}', ${fields} } })`;
		const f = fixture(t, source);
		f.select(0);
		const member = behaviorTreeEditTarget(f.view)!;
		assert.equal(member.branch.entries.length, 1);
		removeBehaviorTreeChild(f.model, member);
		f.refresh();
		assert.equal(f.view.document.syntaxComplete, true);
		assert.equal(f.viewport.model.nodes[0].children[0].children.length, 0);
		assert.equal(f.view.selection, null);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), source);
	}
});

test('unknown membership, roots, parallel roles, outline and recovery have no source-removal target', t => {
	for (const root of [
		"{ type = 'sequence', children = build() }",
		"{ type = 'sequence', children = { [1] = leaf, leaf } }",
		"{ type = 'sequence', children = { [slot] = leaf, leaf } }",
		"{ type = 'simple_parallel', main_task = leaf, background_tree = leaf }",
		"{ type = 'wait', services = { build_service() }, decorators = { build_gate() } }",
	]) {
		const f = fixture(t, `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
trees.register('admission', { root = ${root} })`);
		for (const item of [...f.viewport.model.nodes, ...f.viewport.model.edges]) {
			f.viewport.selection = item;
			assert.equal(behaviorTreeEditTarget(f.view), null);
		}
	}
	const mutated = fixture(t, BT_ORDER_SOURCE.replace('local root<const>', 'children[1] = nested\nlocal root<const>'));
	mutated.select(0);
	assert.equal(behaviorTreeEditTarget(mutated.view), null);
	const f = fixture(t);
	f.select(1);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '\n@' }]);
	f.refresh();
	assert.equal(f.view.document.syntaxComplete, false);
	assert.equal(behaviorTreeEditTarget(f.view), null);
	f.model.undo(); f.refresh();
	assert.ok(behaviorTreeEditTarget(f.view));
	f.view.presentation = createBehaviorLensOutline();
	assert.equal(behaviorTreeEditTarget(f.view), null);
});

test('hidden source history and warm admission use retained correspondence rather than reparsing or choosing a successor', t => {
	const f = fixture(t);
	f.select(1);
	const member = behaviorTreeEditTarget(f.view);
	const graph = f.viewport.model;
	const document = f.view.document;
	for (let index = 0; index < 1000; index += 1) {
		assert.equal(behaviorTreeEditTarget(f.view), member);
		prepareBehaviorLensLayout(f.view);
	}
	assert.equal(f.viewport.model, graph);
	assert.equal(f.view.document, document);
	removeBehaviorTreeChild(f.model, member!);
	f.refresh();
	const removed = f.view.document;
	f.model.undo();
	assert.equal(f.view.document, removed, 'hidden Undo maps ranges without rebuilding a view');
	f.refresh();
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
	assert.equal(f.viewport.selection, null);
	f.select(2);
	const source = readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!);
	f.model.redo(); f.refresh();
	assert.equal(f.viewport.selection, f.viewport.model.nodes[0].children[0].children[1]);
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), source, 'a later explicit survivor selection maps through redo');
});
