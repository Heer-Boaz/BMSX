import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { luaSourceRangeToTextRange, readLuaSourceRange, createLuaTableFieldRemovalEdits } from '../../ide/language/lua/source_edits';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { findVisibleRowIndex, installBehaviorLensDocument, rebuildBehaviorLensRows } from '../../ide/workbench/contrib/behavior_lens/layout';
import { BehaviorLensNavigationResult, executeBehaviorLensNavigation, selectedBehaviorLensSourceRange, selectBehaviorLensRow } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import type { BehaviorSourceNode } from '../../ide/workbench/contrib/behavior_lens/model';
import type { BehaviorTreeSourceNode } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { getCachedLuaParse } from '../../toolchain/ts/lua/analysis/cache';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { BEHAVIOR_SOURCE_FIXTURE } from '../helpers/behavior_source_fixture';

function fixture(source = BEHAVIOR_SOURCE_FIXTURE) {
	const model = new EditorTextModel({ domain: 0, path: 'behavior_fixture.lua',
		source: { resid: 'behavior_fixture', type: 'lua', source_path: 'behavior_fixture.lua', generated: false },
	}, 'lua', source);
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), model.resource.path));
	const input = new BehaviorLensInput(model, createBehaviorLensViewState(project(), model, 'outline', assert.fail), () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	model.onDidChangeContent(event => mapBehaviorLensSourceRanges(input.view, model.resource, event));
	assert.ok(input.view.presentation.kind === 'outline');
	return { model, input, view: input.view, outline: input.view.presentation, refresh() {
		installBehaviorLensDocument(input.view, project());
	} };
}

function tree(f: ReturnType<typeof fixture>, index = 0) {
	const definition = f.view.document.definitions[index];
	assert.equal(definition.behaviorKind, 'behavior_tree');
	assert.ok(definition.behaviorKind === 'behavior_tree');
	assert.ok(definition.root !== null && definition.root.kind === 'node');
	return definition;
}

function childEntries(node: BehaviorTreeSourceNode) {
	assert.ok(node.kind === 'node');
	const branch = node.branches[0];
	assert.ok(branch.role === 'children');
	return branch.entries;
}

function select(f: ReturnType<typeof fixture>, node: BehaviorSourceNode) {
	f.outline.collapsedRowKeys.clear();
	rebuildBehaviorLensRows(f.view, f.outline);
	selectBehaviorLensRow(f.view, f.outline, findVisibleRowIndex(f.outline, node.rowKey));
	assert.ok(f.outline.selectionIndex >= 0);
}

test('typed BT relationships and the outline use the same occurrence objects and original syntax', () => {
	const f = fixture();
	const definition = tree(f);
	const root = definition.root!;
	assert.ok(root.kind === 'node');
	assert.equal(definition.children[0], definition.blackboard);
	assert.equal(definition.children[1], root);
	assert.equal(root.nodeType, 'sequence');
	const children = childEntries(root);
	assert.deepEqual(children.map(entry => entry.index), [1, 2, 3]);
	assert.notEqual(children[0].node, children[1].node);
	assert.equal(children[0].node.authoredRange, children[1].node.authoredRange);
	assert.notDeepEqual(children[0].node.occurrenceRange, children[1].node.occurrenceRange);
	const branch = root.branches[0];
	assert.ok(branch.role === 'children');
	assert.deepEqual(branch.source.children, children.map(entry => entry.node));
	assert.equal(readLuaSourceRange(f.model.buffer, children[1].field.range), 'shared');
	assert.deepEqual(root.attachments.map(group => group.role), ['services', 'decorators']);
	for (const group of root.attachments) {
		assert.equal(group.source.children[0], group.entries[0].node);
	}
	assert.deepEqual(root.branches.map(item => item.role), ['children']);
	const weighted = children[2].node;
	assert.ok(weighted.kind === 'node');
	const choices = weighted.branches[0];
	assert.ok(choices.role === 'choices');
	assert.deepEqual(choices.entries.map(entry => entry.index), [1, 2]);
	const choice = choices.entries[1].node;
	assert.ok(choice.kind === 'section');
	assert.equal(choice.children[0], choice.child);
	assert.equal(readLuaSourceRange(f.model.buffer, choice.weight!.value.range), 'weights.retreat');
	assert.equal(choice.child.authoredRange, children[0].node.authoredRange);
	assert.notEqual(choice.child.rowKey, children[0].node.rowKey);
	const parallel = tree(f, 1).root!;
	assert.ok(parallel.kind === 'node');
	assert.deepEqual(parallel.branches.map(item => item.role), ['main_task', 'background_tree']);
	assert.notDeepEqual(definition.occurrenceRange, tree(f, 1).occurrenceRange);
});

test('source projection retains unknown array membership and leaves dynamic construction opaque', () => {
	const f = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
local cyclic<const> = { type = 'sequence' }
cyclic.children = { cyclic }
trees.register('mixed', { root = { type = 'sequence', children = {
	{ type = 'wait', duration_ticks = 2 }, [4] = cyclic, [key] = build_node(),
} } })
trees.register('dynamic', build_tree())
`);
	const root = tree(f).root!;
	const entries = childEntries(root);
	assert.deepEqual(entries.map(entry => entry.index), [null, null]);
	assert.equal(root.resolution, 'partial');
	assert.ok(root.kind === 'node');
	const branch = root.branches[0];
	assert.ok(branch.role === 'children');
	assert.ok(branch.source.children.some(node => node.kind === 'dynamic'));
	const dynamic = f.view.document.definitions[1];
	assert.ok(dynamic.behaviorKind === 'behavior_tree');
	assert.equal(dynamic.root, null);
	assert.equal(dynamic.resolution, 'unresolved');

	const recursive = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
local subtree<const> = { type = 'sequence', children = { subtree } }
trees.register('cycle', { root = subtree })`);
	assert.equal(childEntries(tree(recursive).root!)[0].node.kind, 'dynamic');
});

test('a scalar node with incidental children does not publish control-flow branches', () => {
	const f = fixture(`local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('leaf', { root = { type = 'wait', children = { { type = 'wait' } } } })`);
	const root = tree(f).root!;
	assert.ok(root.kind === 'node');
	assert.deepEqual(root.branches, []);
});

test('deep reused subtrees retain separate occurrence chains through source edits', () => {
	const lines = ["local trees<const> = require('cartlib/behaviour_tree/library')", "local n0<const> = { type = 'wait' }"];
	for (let index = 1; index <= 64; index += 1) {
		lines.push(`local n${index}<const> = { type = 'sequence', children = { n${index - 1} } }`);
	}
	lines.push("trees.register('deep', { root = { type = 'sequence', children = { n64, n64 } } })");
	const f = fixture(lines.join('\n'));
	const leaves = f.view.source.nodes.filter(node => node.label === 'wait');
	assert.equal(leaves.length, 2);
	assert.deepEqual(leaves[0].occurrenceRange, leaves[1].occurrenceRange, 'shared descendants alone do not identify the parent use');
	assert.notEqual(leaves[0].rowKey, leaves[1].rowKey);
	select(f, leaves[1]);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shifted deep source\n' }]);
	f.refresh();
	assert.equal(f.outline.rows[f.outline.selectionIndex].node, f.view.source.nodes.filter(node => node.label === 'wait')[1]);
});

test('hidden-pane edits preserve selected reused descendants, independent collapse and the chosen duplicate registration', () => {
	const f = fixture();
	const definition = tree(f);
	const entries = childEntries(definition.root!);
	const nested = childEntries(entries[1].node)[0].node;
	select(f, nested);
	f.outline.collapsedRowKeys.add(entries[0].node.rowKey);
	f.view.definitionRowKey = definition.rowKey;
	f.view.sourceMatchRowKeys.add(definition.rowKey);
	const oldDocument = f.view.document;
	const oldSelectedKey = nested.rowKey;
	const insert = luaSourceRangeToTextRange(f.model.buffer, entries[0].field.range);
	const prefix = '-- 🐉 source insertion\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	f.model.pushEditOperations([{ offset: insert.start + prefix.length, deleteLength: 0, text: "{ type = 'wait' }, " }]);
	assert.equal(f.view.document, oldDocument, 'hidden input tracks ranges without parsing or replacing the projection');
	f.refresh();
	const nextEntries = childEntries(tree(f).root!);
	const nextSelected = childEntries(nextEntries[2].node)[0].node;
	assert.notEqual(nextSelected.rowKey, oldSelectedKey, 'the source use survived while its array-derived row key changed');
	assert.equal(f.outline.rows[f.outline.selectionIndex].node, nextSelected);
	assert.ok(f.outline.collapsedRowKeys.has(nextEntries[1].node.rowKey));
	assert.ok(!f.outline.collapsedRowKeys.has(nextEntries[2].node.rowKey));
	assert.equal(f.view.definitionRowKey, tree(f).rowKey);
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'leaf');
});

test('removing a reused occurrence never selects the next namesake, including undo before refresh', () => {
	for (const undoBeforeRefresh of [false, true]) {
		const f = fixture();
		const entries = childEntries(tree(f).root!);
		select(f, childEntries(entries[0].node)[0].node);
		const parsed = getCachedLuaParse({ source: f.model.buffer.getText(), path: f.model.resource.path }).parsed;
		f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, parsed.tokens, entries[0].field));
		if (undoBeforeRefresh) f.model.undo();
		f.refresh();
		assert.equal(f.outline.selectionIndex, -1);
		assert.equal(selectedBehaviorLensSourceRange(f.view), null);
		if (!undoBeforeRefresh) {
			f.model.undo();
			f.refresh();
			assert.equal(f.outline.selectionIndex, -1);
		}
	}
});

test('inserting a same-id registration preserves the original registration rather than its ordinal', () => {
	const f = fixture();
	const definition = tree(f, 1);
	select(f, definition);
	f.view.definitionRowKey = definition.rowKey;
	const first = luaSourceRangeToTextRange(f.model.buffer, tree(f).occurrenceRange);
	f.model.pushEditOperations([{ offset: first.start, deleteLength: 0,
		text: "trees.register('fixture.tree', { root = { type = 'wait' } })\n" }]);
	f.refresh();
	assert.equal(f.outline.rows[f.outline.selectionIndex].node, tree(f, 2));
	assert.equal(f.view.definitionRowKey, tree(f, 2).rowKey);
	assert.notEqual(f.view.definitionRowKey, definition.rowKey);
});

test('reordering source preserves untouched occurrences but does not infer cut/paste identity', () => {
	for (const movingSelected of [false, true]) {
		const f = fixture();
		const entries = childEntries(tree(f).root!);
		select(f, childEntries(entries[movingSelected ? 0 : 1].node)[0].node);
		const span = luaSourceRangeToTextRange(f.model.buffer, entries[0].field.range);
		f.model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start + 1, text: '' }]);
		f.model.pushEditOperations([{ offset: f.model.buffer.getText().indexOf('\n\t\t},\n\t},\n}'),
			deleteLength: 0, text: '\n\t\t\tshared,' }]);
		f.refresh();
		if (movingSelected) {
			assert.equal(f.outline.selectionIndex, -1, 'a source move needs explicit correspondence, not a namesake search');
		} else {
			assert.equal(f.outline.rows[f.outline.selectionIndex].node, childEntries(childEntries(tree(f).root!)[0].node)[0].node);
		}
	}
});

test('an absent selection stays absent until explicit navigation, which starts at the first row', () => {
	const f = fixture();
	const collapsed = [...f.outline.collapsedRowKeys];
	assert.equal(f.outline.selectionIndex, -1);
	for (const command of ['activate', 'left', 'right'] as const) {
		assert.equal(executeBehaviorLensNavigation(f.view, command), BehaviorLensNavigationResult.None);
		assert.equal(f.outline.selectionIndex, -1);
	}
	assert.deepEqual([...f.outline.collapsedRowKeys], collapsed);
	assert.equal(executeBehaviorLensNavigation(f.view, 'down'), BehaviorLensNavigationResult.Changed);
	assert.equal(f.outline.selectionIndex, 0);
});

test('partial initializer edits preserve a reference occurrence; replacing that reference clears it', () => {
	const f = fixture();
	const entry = childEntries(tree(f).root!)[1];
	select(f, entry.node);
	const text = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: text.indexOf('duration_ticks = 2') + 'duration_ticks = '.length, deleteLength: 1, text: '22' }]);
	f.refresh();
	assert.equal(f.outline.rows[f.outline.selectionIndex].node, childEntries(tree(f).root!)[1].node);
	const current = childEntries(tree(f).root!)[1];
	const span = luaSourceRangeToTextRange(f.model.buffer, current.field.value.range);
	f.model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: 'leaf' }]);
	f.refresh();
	assert.equal(f.outline.selectionIndex, -1);
});

test('a source replacement cannot reattach selection or collapse to a same-named definition', () => {
	const f = fixture();
	const definition = tree(f);
	select(f, definition);
	f.view.definitionRowKey = definition.rowKey;
	f.outline.collapsedRowKeys.add(definition.rowKey);
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: BEHAVIOR_SOURCE_FIXTURE }]);
	f.refresh();
	assert.equal(f.outline.selectionIndex, -1);
	assert.equal(f.view.definitionRowKey, null);
	assert.ok(!f.outline.collapsedRowKeys.has(tree(f).rowKey));
});

test('sibling occurrence spans are unique across BT, FSM and effect source producers', () => {
	const f = fixture(BEHAVIOR_SOURCE_FIXTURE + `
local fsm<const> = require('cartlib/fsm/library')
local effects<const> = require('cartlib/actioneffects')
local states<const> = {
	idle = { update = actor.idle, on = { start = { go = '/active' } },
		input_event_handlers = { { pattern = 'a[jp]', go = '/active' } } },
	active = { initial = 'walk', states = { walk = {}, run = {} } },
}
fsm.register('first', { initial = 'idle', states = states })
fsm.register('second', { states = states })
effects.register_effect('effect', { period_ms = 2, blocked_tags = { 'busy' },
	can_trigger = actor.ready, handler = actor.fire })
`);
	function visit(nodes: readonly BehaviorSourceNode[]) {
		const starts = new Set<number>();
		for (const node of nodes) {
			const span = luaSourceRangeToTextRange(f.model.buffer, node.occurrenceRange);
			assert.ok(!starts.has(span.start));
			starts.add(span.start);
			visit(node.children);
		}
	}
	visit(f.view.document.definitions);
	const entry = childEntries(tree(f).root!)[0];
	assert.equal(entry.field.value.kind, LuaSyntaxKind.IdentifierExpression);
	assert.deepEqual(f.view.document.definitions.slice(2).map(node => node.behaviorKind), ['state_machine', 'state_machine', 'action_effect']);
	const update = f.view.source.nodes.filter(node => node.label === 'update = actor.idle')[1];
	select(f, update);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved source\n' }]);
	f.refresh();
	assert.equal(f.outline.rows[f.outline.selectionIndex].node, f.view.source.nodes.filter(node => node.label === 'update = actor.idle')[1]);
});
