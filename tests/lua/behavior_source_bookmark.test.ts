import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createBehaviorTreeEditFixture } from '../helpers/behavior_tree_edit_fixture';
import { BT_TRANSFER_SOURCE, transferBehaviorFixtureSelection } from '../helpers/behavior_transfer_fixture';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { behaviorSourceEditState } from '../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';

function fixture(t: TestContext, weighted = false, edge = false, definition = 1) {
	const source = weighted ? BT_TRANSFER_SOURCE
		.replace("type = 'sequence', children = { leaf, moved, leaf }", "type = 'weighted_random_selector', choices = { {weight=1,child=leaf}, {weight=2,child=moved} }")
		.replace("type = 'sequence', children = { moved }", "type = 'weighted_random_selector', choices = { {weight=2,child=moved} }") : BT_TRANSFER_SOURCE;
	const f = createBehaviorTreeEditFixture(t, source, definition);
	const root = f.view.document.definitions[definition];
	assert.ok(root.behaviorKind === 'behavior_tree' && root.root?.kind === 'node');
	const branches = root.root.branches[0];
	assert.ok(branches.role === 'children');
	const from = branches.entries[0].node;
	const to = branches.entries[2].node; // Second occurrence of the SAME destination initializer.
	assert.ok(from.kind === 'node' && to.kind === 'node');
	const origin = from.branches[0];
	const target = to.branches[0];
	assert.ok((origin.role === 'children' || origin.role === 'choices') && (target.role === 'children' || target.role === 'choices'));
	assert.ok(origin.source.kind === 'section');
	const entry = origin.entries[1];
	const node = weighted && !edge ? entry.node.children[0] : entry.node;
	f.view.collapsedRowKeys.clear(); f.graph.dirty = true; prepareBehaviorLensLayout(f.view);
	f.viewport.selection = edge ? f.viewport.model.edgesBySource.get(node.rowKey)! : f.viewport.model.nodesBySource.get(node.rowKey)!;
	acceptBehaviorGraphSelection(f.view, f.graph);
	const member = { table: origin.source.table, entries: origin.entries, index: 1 };
	return { ...f, source, target, member, transfer: () => transferBehaviorFixtureSelection(f.model, f.view, member, target) };
}

test('explicit bookmarks follow a new parent, chosen registration and shared destination occurrence through ordinary Undo/Redo', t => {
	for (const [weighted, edge] of [[false, false], [true, false], [true, true]]) {
		const f = fixture(t, weighted, edge);
		f.transfer(); f.refresh();
		const transferred = f.model.buffer.getText();
		for (const action of [() => {}, () => f.model.undo(), () => f.model.redo(), () => f.model.undo(), () => f.model.redo()]) {
			action(); f.refresh();
			assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
			const selected = f.viewport.selection!;
			assert.equal(selected.kind, edge ? 'edge' : 'node');
			assert.equal(readLuaSourceRange(f.model.buffer, selected.kind === 'node' ? selected.source.occurrenceRange : selected.range),
				edge ? '{weight=2,child=moved}' : 'moved');
			const child = selected.kind === 'node' ? selected : selected.child;
			assert.equal(child.member!.index, 1, 'not the equal-valued existing first child');
			assert.equal(child.parent!.member!.index, f.model.buffer.getText() === transferred ? 2 : 0,
				'not the first use of the destination initializer or the previous parent');
			assert.equal(f.view.selectionBookmark, undefined, 'projection consumes the single pending bookmark');
		}
	}
});

test('hidden edits map a pending bookmark, while history values remain immutable and a later Undo replaces the pending state', t => {
	const f = fixture(t);
	const document = f.view.document;
	f.transfer();
	const pending = f.view.selectionBookmark!;
	const expected = JSON.stringify(pending);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix 🐉\r\n' }]);
	assert.equal(f.view.document, document, 'hidden content events never parse or publish a graph');
	assert.notEqual(JSON.stringify(f.view.selectionBookmark), expected);
	f.model.undo();
	f.refresh();
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(f.viewport.selection.parent!.member!.index, 2);
	const record = f.model.undo()!;
	assert.ok(record.afterEditState!.is(behaviorSourceEditState));
	assert.equal(JSON.stringify(record.afterEditState.value), expected, 'mapping did not mutate a history bookmark');
	f.model.redo(); f.model.undo(); f.refresh();
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(f.viewport.selection.parent!.member!.index, 0);
	assert.equal(f.model.buffer.getText(), f.source);
});

test('replacing selected source still clears selection; identical text is not a bookmark recovery path', t => {
	const f = fixture(t);
	f.transfer();
	const source = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: 0, deleteLength: source.length, text: source }]);
	f.refresh();
	assert.equal(f.view.selection, null);
	f.model.undo(); f.refresh();
	assert.equal(f.view.selection, null, 'ordinary replacement Undo carries no explicit selection');
	f.model.undo(); f.refresh();
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(f.viewport.selection.parent!.member!.index, 0, 'the transfer record itself restores its explicit origin');
});

test('a later definition choice does not change the selection recorded with a document edit', t => {
	const f = fixture(t);
	f.transfer(); f.refresh();
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	f.model.undo(); f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(f.viewport.selection.parent!.member!.index, 0);
});

test('a chosen destination under another registration is explicit edit state, not the previously active definition', t => {
	const f = fixture(t, false, false, 0);
	const definition = f.view.document.definitions[1];
	assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
	const children = definition.root.branches[0];
	assert.ok(children.role === 'children' && children.entries[2].node.kind === 'node');
	const target = children.entries[2].node.branches[0];
	assert.ok(target.role === 'children');
	transferBehaviorFixtureSelection(f.model, f.view, f.member, target); f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
	f.model.undo(); f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[0].rowKey);
	f.model.redo(); f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
});

test('a bookmark can retain a selected descendant whose initializer bytes were not part of the transferred field', t => {
	const f = fixture(t);
	assert.ok(f.viewport.selection?.kind === 'node');
	f.viewport.selection = f.viewport.selection.children[0];
	acceptBehaviorGraphSelection(f.view, f.graph);
	f.transfer(); f.refresh();
	assert.ok(f.viewport.selection?.kind === 'node');
	assert.equal(readLuaSourceRange(f.model.buffer, f.viewport.selection.source.occurrenceRange), 'leaf');
	assert.equal(f.viewport.selection.parent!.parent!.member!.index, 2);
	f.model.undo(); f.refresh();
	assert.equal(f.viewport.selection.parent!.parent!.member!.index, 0);
});

test('unannotated transfers keep the strict parent-correspondence rule rather than guessing a moved selection', t => {
	const f = fixture(t);
	assert.ok(f.target.source.kind === 'section');
	const transfer = createLuaTableFieldTransfer(f.model.buffer, f.model.resource.path, f.member.entries[1].field,
		f.target.source.table, f.target.source.table.fields.length);
	f.model.pushEditOperations(transfer.edits); f.refresh();
	assert.equal(f.view.selection, null);
	f.model.undo(); f.refresh();
	assert.equal(f.view.selection, null);
});
