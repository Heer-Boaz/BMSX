import { semanticSnapshot } from './semantic_test_harness';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LuaSyntaxKind, LuaTableFieldKind } from '../../toolchain/ts/lua/syntax/ast';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { SourceTableIssue } from '../../ide/workbench/contrib/behavior_lens/source';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { installBehaviorLensDocument, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { ACTIONEFFECT_PARTIAL_SOURCE, ACTIONEFFECT_SOURCE } from '../helpers/actioneffect_source_fixture';

const resource = { domain: 0 as const, path: 'effects.lua', source: { resid: 'effects', type: 'lua' as const } };
function document(source: string) {
	return buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)));
}

test('ActionEffect fields retain typed source properties and requirement entries on the same outline occurrences', () => {
	const definitions = document(ACTIONEFFECT_SOURCE).definitions;
	assert.equal(definitions.length, 2);
	const first = definitions[0];
	const second = definitions[1];
	assert.ok(first.behaviorKind === 'action_effect' && second.behaviorKind === 'action_effect');
	assert.ok(first.body !== null && second.body !== null);
	assert.equal(first.body.table, second.body.table, 'immutable initializer is shared, not re-parsed');
	assert.equal(first.body.issues, SourceTableIssue.None);
	assert.deepEqual(first.body.fields.map(field => field.kind === 'unknown' ? 'unknown' : field.name), [
		'required_tags', 'blocked_tags', 'required_state_paths', 'blocked_state_paths', 'initial_cooldown_ms',
		'cooldown_ms', 'calculate_cooldown_ms', 'defer_cooldown_commit', 'period_ms', 'can_trigger', 'handler', 'event',
	]);
	for (let index = 0; index < first.body.fields.length; index += 1) {
		const field = first.body.fields[index];
		assert.equal(first.children[index], field.source);
		assert.equal(field.field, first.body.table.fields[index]);
		assert.equal(field.field, second.body.fields[index].field);
		assert.notEqual(field.source.rowKey, second.body.fields[index].source.rowKey, 'each registration is its own use');
		if (field.kind !== 'list') continue;
		assert.ok(field.source.kind === 'section');
		assert.equal(field.source.issues, SourceTableIssue.None);
		assert.equal(field.entries[0].field, field.source.table.fields[0]);
		assert.equal(field.entries[0].index, 1);
		assert.equal(field.entries[0].node, field.source.children[0]);
	}
	const required = first.body.fields[0];
	assert.equal(required.source.referenceRange!.start.line, 4, 'list use and initializer have distinct source roles');
	assert.equal(required.source.authoredRange.start.line, 2);
});

test('ActionEffect values stay authored AST, with no inferred event, timing, defaults or callback outcomes', () => {
	const [effect] = document(`local fx<const> = require('cartlib/actioneffects')
local never<const> = function() error('must not execute in an editor') end
fx.register_effect('values', { event = false, period_ms = cadence() * 2, handler = never, cooldown_ms = nil })`).definitions;
	assert.ok(effect.behaviorKind === 'action_effect' && effect.body !== null);
	assert.deepEqual(effect.body.fields.map(field => field.field.value.kind), [
		LuaSyntaxKind.BooleanLiteralExpression, LuaSyntaxKind.BinaryExpression, LuaSyntaxKind.IdentifierExpression, LuaSyntaxKind.NilLiteralExpression,
	]);
	assert.equal(effect.body.fields.length, 4, 'absent fields are not filled from runtime defaults');
	assert.ok(effect.body.fields.every(field => field.kind === 'value' && field.source.children.length === 0));
	assert.equal(effect.body.fields[2].source.label, 'handler = never');
});

test('computed effect keys and partial requirement lists stay source-visible without invented dense indices', () => {
	const [effect] = document(ACTIONEFFECT_PARTIAL_SOURCE).definitions;
	assert.ok(effect.behaviorKind === 'action_effect' && effect.body !== null);
	assert.equal(effect.resolution, 'partial');
	assert.ok(effect.body.issues & SourceTableIssue.ComputedKey);
	const unknown = effect.body.fields[1];
	assert.equal(unknown.kind, 'unknown');
	assert.equal(unknown.field.kind, LuaTableFieldKind.ExpressionKey);
	assert.equal(unknown.source, effect.children[1]);
	assert.equal(unknown.source.authoredRange.start.line, 5);
	const list = effect.body.fields[2];
	assert.ok(list.kind === 'list' && list.source.kind === 'section');
	assert.ok(list.source.issues & SourceTableIssue.NumericKey);
	assert.ok(list.source.issues & SourceTableIssue.ComputedKey);
	assert.deepEqual(list.entries.map(entry => entry.index), [null, null]);
	assert.equal(list.entries[1].field.kind, LuaTableFieldKind.ExpressionKey);
	assert.equal(list.source.children[2].kind, 'dynamic');
	const dynamic = effect.body.fields[3];
	assert.ok(dynamic.kind === 'list' && dynamic.source.kind === 'dynamic');
	assert.equal(dynamic.entries.length, 0, 'unresolved collection is not a proven empty requirement list');
});

test('last static effect field wins; known writes and unresolved definitions are not complete source models', () => {
	const definitions = document(`local fx<const> = require('cartlib/actioneffects')
local shared<const> = { period_ms = 10, ['period_ms'] = 20 }
local alias<const> = shared
alias.period_ms = 30
fx.register_effect('changed', alias)
fx.register_effect('dynamic', builders.effect())
fx.register_effect('empty', {})`).definitions;
	const first = definitions[0];
	assert.ok(first.behaviorKind === 'action_effect' && first.body !== null);
	assert.ok(first.body.issues & SourceTableIssue.KnownMutation);
	assert.equal(first.body.fields.length, 1);
	assert.equal(first.body.fields[0].field, first.body.table.fields[1]);
	assert.equal(first.body.fields[0].source.label, 'period_ms = 20', 'retains initializer syntax, not a fabricated evaluated property');
	const dynamic = definitions[1];
	const empty = definitions[2];
	assert.ok(dynamic.behaviorKind === 'action_effect' && empty.behaviorKind === 'action_effect');
	assert.equal(dynamic.body, null);
	assert.equal(dynamic.resolution, 'unresolved');
	assert.ok(empty.body !== null);
	assert.equal(empty.body.fields.length, 0);
	assert.equal(empty.resolution, 'complete');
});

test('effect fields in a reused initializer follow their own registration through hidden edits and Undo', () => {
	const model = new EditorTextModel(resource, 'lua', ACTIONEFFECT_SOURCE);
	const view = createBehaviorLensViewState(document(ACTIONEFFECT_SOURCE), model, 'outline', assert.fail);
	model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, model.resource, event));
	selectBehaviorLensDefinition(view, view.document.definitions[1].rowKey);
	const second = view.document.definitions[1];
	assert.ok(second.behaviorKind === 'action_effect' && second.body !== null);
	const period = second.body.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	view.selection = { kind: 'node', rowKey: period.source.rowKey };
	const previous = view.document;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 prefix\n' }]);
	const offset = model.buffer.getText().indexOf('period_ms = 20') + 'period_ms = '.length;
	model.pushEditOperations([{ offset, deleteLength: 2, text: '35' }]);
	assert.equal(view.document, previous, 'hidden mapping does not parse or project');
	installBehaviorLensDocument(view, document(model.buffer.getText()));
	assert.equal(view.definitionRowKey, view.document.definitions[1].rowKey);
	const selected = view.source.nodesByRowKey.get(view.selection!.rowKey)!;
	assert.equal(selected.label, 'period_ms = 35');
	assert.equal(selected.authoredRange.start.line, period.source.authoredRange.start.line + 1);
	model.undo();
	installBehaviorLensDocument(view, document(model.buffer.getText()));
	assert.equal(view.source.nodesByRowKey.get(view.selection!.rowKey)!.label, 'period_ms = 20');
	assert.equal(view.definitionRowKey, view.document.definitions[1].rowKey);
});

test('recoverable incomplete effect source remains partial instead of becoming an executable definition', () => {
	const [effect] = document("local fx<const> = require('cartlib/actioneffects')\nfx.register_effect('retained', { period_ms = 20 })\nlocal unfinished =").definitions;
	assert.ok(effect.behaviorKind === 'action_effect');
	assert.notEqual(effect.resolution, 'complete');
	assert.equal(document("local fx<const> = require('cartlib/actioneffects')\nfx.register_effect('unfinished', { period_ms = 20, handler = function(owner)\n owner:").definitions.length, 0,
		'a registration not retained by parser recovery is not fabricated by the contribution');
});
