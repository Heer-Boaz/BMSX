import assert from 'node:assert/strict';
import test from 'node:test';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { behaviorTreeEditTarget, duplicateBehaviorTreeChild } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { BT_ORDER_SOURCE } from '../helpers/behavior_order_fixture';
import { createBehaviorTreeEditFixture as fixture } from '../helpers/behavior_tree_edit_fixture';

test('BT duplication inserts first/middle/last source entries, not metadata ranks or referenced initializers', t => {
	for (const [index, field, anchor, insertion] of [
		[0, 'leaf', '\t-- first documentation', '\tleaf,\n'],
		[1, 'nested', '\t-- nested documentation', '\tnested;\n'],
		[2, 'make_node(3)', '\t-- last documentation', '\tmake_node(3);\n'],
	] as const) {
		const f = fixture(t);
		f.select(index);
		const member = behaviorTreeEditTarget(f.view)!;
		assert.equal(member.table.fields.length, 4, 'named metadata is not a child');
		assert.equal(readLuaSourceRange(f.model.buffer, member.branch.entries[index].field.range), field);
		let events = 0;
		f.model.onDidChangeContent(() => { events += 1; });
		duplicateBehaviorTreeChild(f.model, member);
		assert.equal(events, 1);
		const expected = BT_ORDER_SOURCE.replace(anchor, insertion + anchor);
		assert.equal(f.model.buffer.getText(), expected, 'only complete field syntax is copied; exterior documentation stays put');
		f.refresh();
		assert.equal(f.view.document.syntaxComplete, true);
		assert.equal(f.viewport.model.nodes[0].children[0].children.length, 4);
		assert.equal(f.viewport.selection, f.viewport.model.nodes[0].children[0].children[index + 1]);
		assert.equal(behaviorTreeEditTarget(f.view)!.index, index + 1);
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), field);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
		assert.equal(f.model.canUndo, false, 'one document Undo element');
		assert.equal(f.model.dirty, false);
		assert.equal(f.viewport.selection, f.viewport.model.nodes[0].children[0].children[index]);
		f.model.redo(); f.refresh();
		assert.equal(f.model.buffer.getText(), expected);
		assert.equal(behaviorTreeEditTarget(f.view)!.index, index + 1);
	}
});

test('weighted cards and connections duplicate the complete choice and retain their distinct source-selection roles', t => {
	for (const edge of [false, true]) {
		const f = fixture(t, BT_ORDER_SOURCE, 2);
		f.select(1, edge);
		const selectedSource = edge ? '{ weight = 9, child = nested }' : 'nested';
		duplicateBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
		f.refresh();
		const field = '\t{ weight = 9, child = nested },';
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE.replace(field, `${field}\n${field}`));
		assert.deepEqual(f.viewport.model.nodes[0].children[0].children.map(node => node.lines[0]),
			['CHOICE 1  W=1', 'CHOICE 2  W=9', 'CHOICE 3  W=9', 'CHOICE 4  W=3']);
		assert.equal(behaviorTreeEditTarget(f.view)!.index, 2);
		assert.equal(f.viewport.selection!.kind, edge ? 'edge' : 'node');
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), selectedSource);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
		assert.equal(behaviorTreeEditTarget(f.view)!.index, 1);
		assert.equal(f.viewport.selection!.kind, edge ? 'edge' : 'node');
		f.model.redo(); f.refresh();
		assert.equal(behaviorTreeEditTarget(f.view)!.index, 2);
		assert.equal(f.viewport.selection!.kind, edge ? 'edge' : 'node');
	}
});

test('repeated copies remain fully expanded through hidden history, without graph identity overrides', t => {
	const f = fixture(t, BT_ORDER_SOURCE, 1);
	f.select(1);
	for (let count = 1; count <= 2; count += 1) {
		duplicateBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
		f.refresh();
		assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
		const children = f.viewport.model.nodes[0].children[0].children;
		assert.equal(f.viewport.selection, children[count + 1]);
		assert.equal(children[count + 1].children.length, 2, 'retained bytes keep the selected expanded subtree');
		for (let index = 1; index <= count; index += 1) assert.equal(children[index].children.length, 2, 'inserted namesakes are fully visible without inheriting selection');
	}
	const document = f.view.document;
	f.model.undo(); f.model.undo();
	assert.equal(f.view.document, document, 'hidden history maps retained source ranges, not topology');
	f.refresh();
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
	assert.equal(behaviorTreeEditTarget(f.view)!.index, 1);
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(f.viewport.selection.children.length, 2);
	f.model.redo(); f.model.redo(); f.refresh();
	assert.equal(behaviorTreeEditTarget(f.view)!.index, 3);
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(f.viewport.selection.children.length, 2);
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	prepareBehaviorLensLayout(f.view);
	assert.equal(f.viewport.model.nodes[0].children[0].children.length, 5, 'both registrations read the one edited constructor');
});

test('a duplicate inside a shared initializer edits that source once, not a private subtree of a registration', t => {
	const f = fixture(t);
	f.select(1);
	assert.ok(f.viewport.selection?.kind === 'node');
	f.viewport.selection = f.viewport.selection.children[0];
	acceptBehaviorGraphSelection(f.view, f.graph);
	duplicateBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
	f.refresh();
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE.replace('children = { leaf, make_node(2) }', 'children = { leaf, leaf, make_node(2) }'));
	assert.equal(behaviorTreeEditTarget(f.view)!.index, 1);
	for (const definition of f.view.document.definitions) {
		selectBehaviorLensDefinition(f.view, definition.rowKey);
		prepareBehaviorLensLayout(f.view);
		f.select(1);
		assert.ok(f.viewport.selection?.kind === 'node');

		assert.ok(f.viewport.selection?.kind === 'node');
		assert.equal(f.viewport.selection.children.length, 3);
	}
	f.model.undo(); f.refresh();
	assert.equal(f.model.buffer.getText(), BT_ORDER_SOURCE);
});

test('sole grouped and opaque members copy interior syntax byte-exactly with source-native CRLF and semicolons', t => {
	for (const [type, list, field] of [
		['sequence', 'children', "({ type = 'task', task = { execute = function(owner)\n\t-- callback 🐉\n\treturn owner:accept([==[literal ; } ,]==]) end } })"],
		['weighted_random_selector', 'choices', "{ weight = 7, -- wrapper 🐉\nchild = build([==[; , }]==]) }"],
		['weighted_random_selector', 'choices', 'build_choice()'],
	] as const) {
		const fieldSource = field.replaceAll('\n', '\r\n');
		const source = `local trees<const> = require('cartlib/behaviour_tree/library')\r\ntrees.register('sole', { root = { type = '${type}', ${list} = { ${fieldSource}; } } })`;
		const f = fixture(t, source);
		f.select(0);
		duplicateBehaviorTreeChild(f.model, behaviorTreeEditTarget(f.view)!);
		f.refresh();
		assert.equal(f.model.buffer.getText(), source.replace(`${fieldSource};`, `${fieldSource}; ${fieldSource};`));
		assert.equal(f.view.document.syntaxComplete, true);
		const member = behaviorTreeEditTarget(f.view)!;
		assert.equal(member.index, 1);
		assert.deepEqual(member.branch.entries.map(entry => readLuaSourceRange(f.model.buffer, entry.field.range)), [fieldSource, fieldSource]);
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), source);
		assert.equal(behaviorTreeEditTarget(f.view)!.index, 0);
	}
});
