import { semanticSnapshot } from './semantic_test_harness';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { BehaviorTreeTransferAnalysis } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_transfer';
import type { BehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/model';
import type { BehaviorTreeSourceList } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_model';
import { SourceTableIssue } from '../../ide/workbench/contrib/behavior_lens/source';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';

const prelude = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
`;
const ordinary = `${prelude}
local from<const> = { type = 'sequence', children = { leaf, note='metadata', leaf } }
local to<const> = { type = 'selector', children = {} }
trees.register('origin', { root=from })
trees.register('target', { root=to })
`;

function rootList(document: BehaviorSourceDocument, index: number): BehaviorTreeSourceList {
	const definition = document.definitions[index];
	assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
	const branch = definition.root.branches[0];
	assert.ok(branch.role === 'children' || branch.role === 'choices');
	return branch;
}

function fixture(t: TestContext, source = ordinary, index = 0, origin = 0) {
	const model = new EditorTextModel({ domain: 0, path: 'transfer.lua', source: { type: 'lua', resid: 'transfer' } }, 'lua', source);
	t.after(() => model.dispose());
	const analysis = buildLuaFileSemanticData(source, model.resource.path);
	const document = buildBehaviorSourceDocument(model.resource, semanticSnapshot(analysis));
	const branch = rootList(document, origin);
	assert.ok(branch.source.kind === 'section');
	const member = { table: branch.source.table, branch, index };
	const transfer = new BehaviorTreeTransferAnalysis(document, analysis, member);
	return { source, model, analysis, document, member, transfer };
}

test('empty destinations and compatible sharing use actual lists, not visible registration or child rank', t => {
	const f = fixture(t, ordinary + "trees.register('same-target', { root=to })\ntrees.register('same-origin', { root=from })");
	const target = rootList(f.document, 1);
	const check = f.transfer.checkTarget(target);
	assert.ok(check.kind === 'available');
	assert.equal(check.targetUses.length, 2);
	assert.equal(f.transfer.sourceUses.length, 2);
	assert.equal(f.member.branch.entries.length, 2);
	assert.equal(f.member.table.fields.length, 3);
	assert.equal(check.targetUses[0].branch, target);
	for (let i = 0; i < 1000; i += 1) assert.equal(f.transfer.checkTarget(target), check);
	assert.equal(f.model.version, 1);
	assert.equal(f.model.dirty, false);
	assert.equal(f.model.buffer.getText(), f.source);
});

test('same constructor under another occurrence is still the existing same-list reorder, not a reparent', t => {
	const f = fixture(t, ordinary.replace('children = {}', 'children = from.children'));
	assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'list-incomplete' }, 'mutable property expressions are not const constructor provenance');
	const shared = fixture(t, `${prelude}
local list<const> = { leaf, leaf }
trees.register('origin', { root={ type='sequence', children=list } })
trees.register('target', { root={ type='selector', children=list } })`);
	assert.deepEqual(shared.transfer.checkTarget(rootList(shared.document, 1)), { kind: 'unavailable', reason: 'same-list' });
});

test('weighted transfers retain the complete field and authored weight, never convert a child into a choice', t => {
	const source = `${prelude}
local from<const> = { type='weighted_random_selector', choices={ {weight=weight(), child=leaf} } }
local to<const> = { type='weighted_random_selector', choices={} }
trees.register('origin', {root=from})
trees.register('target', {root=to})
trees.register('ordinary', {root={type='sequence',children={leaf}}})`;
	const f = fixture(t, source);
	const target = rootList(f.document, 1);
	assert.equal(f.transfer.checkTarget(target).kind, 'available', 'a weight expression is not evaluated or classified as a node dependency');
	assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 2)), { kind: 'unavailable', reason: 'different-list-role' });
	const reverse = fixture(t, source, 0, 2);
	assert.deepEqual(reverse.transfer.checkTarget(rootList(reverse.document, 1)), { kind: 'unavailable', reason: 'different-list-role' });
	assert.ok(target.source.kind === 'section');
	const field = f.member.branch.entries[0].field;
	const text = readLuaSourceRange(f.model.buffer, field.range);
	const result = createLuaTableFieldTransfer(f.model.buffer, f.model.resource.path, field, target.source.table, 0);
	f.model.pushEditOperations(result.edits);
	assert.equal(f.model.buffer.getTextRange(result.fieldRange.start, result.fieldRange.end), text);
	f.model.undo();
	assert.equal(f.model.buffer.getText(), source);
});

test('conflicting shared child, choice and attachment consumers are detected across registrations', t => {
	for (const role of ['choices', 'services', 'decorators'] as const) {
		const type = role === 'choices' ? 'weighted_random_selector' : 'wait';
		const f = fixture(t, `${prelude}
local shared<const> = { leaf }
trees.register('origin', {root={type='sequence', children={leaf}}})
trees.register('target', {root={type='sequence', children=shared}})
trees.register('hidden-conflict', {root={type='${type}', ${role}=shared}})`);
		assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'shared-role-conflict' });
		const conflictedOrigin = fixture(t, f.source, 0, 1);
		assert.deepEqual(conflictedOrigin.transfer.checkTarget(rootList(conflictedOrigin.document, 0)), { kind: 'unavailable', reason: 'shared-role-conflict' });
	}
});

test('alias reachability detects a cycle outside the visible occurrence ancestry', t => {
	const f = fixture(t, `${prelude}
local shared<const> = { leaf }
local nested<const> = { type='sequence', children=shared }
trees.register('origin', {root={type='sequence',children={nested}}})
trees.register('target', {root={type='selector',children=shared}})`);
	assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'cycle' });
});

test('a destination inside travelling syntax is rejected before constructing an overlapping edit', t => {
	const f = fixture(t, `${prelude}
trees.register('origin', {root={type='sequence',children={{type='sequence',children={leaf}}}}})`);
	const nested = f.transfer.listUses[1].branch;
	assert.ok(nested.role === 'children');
	assert.deepEqual(f.transfer.checkTarget(nested), { kind: 'unavailable', reason: 'target-inside-source' });
	assert.equal(f.model.canUndo, false);
});

test('cycle evidence follows simple-parallel and weighted child roles rather than visual folds', t => {
	const f = fixture(t, `${prelude}
local shared<const> = {leaf}
local nested<const> = {type='selector',children=shared}
local parallel<const> = {type='simple_parallel', main_task=leaf, background_tree={type='weighted_random_selector',choices={{weight=1,child=nested}}}}
trees.register('origin',{root={type='sequence',children={parallel}}})
trees.register('target',{root={type='selector',children=shared}})`);
	assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'cycle' });
});

test('opaque unrelated siblings and attachment warnings do not revoke proven selected topology', t => {
	const f = fixture(t, `${prelude}
local task<const> = {type='task',task=callbacks.execute,services=make_services(),decorators=make_gates(), [1]='metadata'}
trees.register('origin',{root={type='sequence',children={task, make_other()}}})
trees.register('target',{root={type='sequence',children={make_other()}}})`);
	assert.equal(f.document.definitions[0].resolution, 'partial');
	assert.equal(f.transfer.checkTarget(rootList(f.document, 1)).kind, 'available');
	const task = f.member.branch.entries[0].node;
	assert.ok(task.kind === 'node');
	assert.equal(task.issues, SourceTableIssue.NumericKey);
});

test('unknown selected topology is not guessed to be a leaf or an empty child list', t => {
	for (const node of ['make_node()', "{type=choose_type()}", "{type='unknown'}", "{type='sequence'}",
		"{type='sequence',children=make_list()}", "{type='simple_parallel',main_task=leaf}", "{type='wait',[key]=leaf}",
		"{type='sequence',children={leaf,make_node()}}", "{type='weighted_random_selector',choices={make_choice()}}",
		"{type='weighted_random_selector',choices={{weight=1,child=make_node()}}}"]) {
		const f = fixture(t, `${prelude}
trees.register('origin',{root={type='sequence',children={${node}}}})
trees.register('target',{root={type='sequence',children={}}})`);
		assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'subtree-incomplete' }, node);
	}
});

test('local constructor mutation is distinct from inherited partial display resolution', t => {
	for (const mutated of ['from', 'to']) {
		const f = fixture(t, ordinary + `\n${mutated}.children = replacement\n`);
		assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'owner-incomplete' });
	}
	const f = fixture(t, ordinary + '\nleaf.type = other_type\n');
	assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'subtree-incomplete' });
});

test('dynamic, explicitly indexed, computed and mutated target lists retain their actual lack of membership evidence', t => {
	for (const list of ['make_list()', '{[1]=leaf}', '{[key]=leaf}']) {
		const f = fixture(t, ordinary.replace('children = {}', `children = ${list}`));
		assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'list-incomplete' });
	}
	const f = fixture(t, `${prelude}
local list<const> ={leaf}
list[1]=leaf
trees.register('origin',{root={type='sequence',children={leaf}}})
trees.register('target',{root={type='sequence',children=list}})`);
	assert.deepEqual(f.transfer.checkTarget(rootList(f.document, 1)), { kind: 'unavailable', reason: 'list-incomplete' });
});

test('a destination shadow returns actual changed-binding evidence even when both locals have the same value', t => {
	const f = fixture(t, `${prelude}
local value<const> =7
trees.register('origin',{root={type='sequence',children={{type='task',task={execute=function(owner) owner.value=value end}}}}})
do
local value<const> =7
trees.register('target',{root={type='sequence',children={}}})
end`);
	const check = f.transfer.checkTarget(rootList(f.document, 1));
	assert.ok(check.kind === 'binding-change');
	assert.equal(check.changes.length, 1);
	const change = check.changes[0];
	assert.ok(change.kind === 'identifier' && change.from.kind === 'declaration' && change.to.kind === 'declaration');
	assert.equal(change.reference.name, 'value');
	assert.notEqual(change.from.declaration.id, change.to.declaration.id);
	assert.equal(f.model.canUndo, false);
});

test('syntax recovery is not admission and a new source generation gets a new operation analysis', t => {
	const first = fixture(t);
	assert.equal(first.transfer.checkTarget(rootList(first.document, 1)).kind, 'available');
	const recovered = fixture(t, ordinary + '\n@');
	assert.equal(recovered.document.syntaxComplete, false);
	assert.deepEqual(recovered.transfer.checkTarget(rootList(recovered.document, 1)), { kind: 'unavailable', reason: 'syntax-incomplete' });
	assert.equal(first.model.dirty, false);
});

test('an imported destination requires a real multi-resource operation rather than writing it through the current buffer', () => {
	const file = buildLuaFileSemanticData(`${prelude}
trees.register('from', {root={type='sequence',children={leaf}}})
trees.register('to', require('target'))`, 'from.lua');
	const provider = buildLuaFileSemanticData("return {root={type='sequence',children={}}}", 'target.lua');
	const document = buildBehaviorSourceDocument({domain:0,path:file.file}, semanticSnapshot(file, provider));
	const branch = rootList(document, 0);
	assert.ok(branch.source.kind === 'section');
	const analysis = new BehaviorTreeTransferAnalysis(document, file, { table: branch.source.table, branch, index: 0 });
	assert.deepEqual(analysis.checkTarget(rootList(document, 1)), { kind: 'unavailable', reason: 'different-write-resource' });
});
