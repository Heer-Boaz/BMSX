import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { installBehaviorLensDocument } from '../../ide/workbench/contrib/behavior_lens/layout';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { buildBehaviorInspection } from '../../ide/workbench/contrib/behavior_lens/inspection';
import { projectActionEffectProperties } from '../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import { SourceTableIssue } from '../../ide/workbench/contrib/behavior_lens/source';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';

function workspace(files: Record<string, string>) {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles(Object.entries(files).map(([path, source]) => buildLuaFileSemanticData(source, path)));
	return workspace;
}

const main = `local trees<const> = require('cartlib/behaviour_tree/library')
local definition = require('definition')
trees.register('imported', definition)`;
const provider = `local kind = 'sequence'
local leaf = { type = 'wait', duration_ticks = 2 }
return { root = { type = kind, children = { leaf, leaf } } }`;

test('imported BT constructors and ordinary aliases keep use, origin and repeated graph occurrences distinct', () => {
	const project = workspace({ 'main.lua': main, 'definition.lua': "return require('provider')", 'provider.lua': provider });
	const snapshot = project.getSnapshot();
	const document = buildBehaviorSourceDocument({ domain: 0, path: 'main.lua' }, snapshot);
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
	assert.equal(definition.authoredRange.path, 'provider.lua');
	assert.equal(definition.referenceRange?.path, 'main.lua');
	assert.equal(definition.root.nodeType, 'sequence');
	const branch = definition.root.branches[0];
	assert.ok(branch.role === 'children');
	const [first, second] = branch.entries;
	assert.equal(first.node.authoredRange, second.node.authoredRange);
	assert.notEqual(first.node.occurrenceRange, second.node.occurrenceRange);
	assert.notEqual(first.node.rowKey, second.node.rowKey);
	assert.deepEqual(document.files.map(file => file.file).sort(), ['definition.lua', 'main.lua', 'provider.lua']);
});

test('imported FSM state/callback sources bind returns in each consuming scope', () => {
	const project = workspace({
		'main.lua': `local fsm<const> = require('cartlib/fsm/library')
local states = require('states')
fsm.register('first', { initial = 'idle', states = states })
fsm.register('second', { states = { room = { initial = 'idle', states = states } } })`,
		'states.lua': "local callback = require('callback')\nreturn { idle = { update = callback }, active = {} }",
		'callback.lua': "local next_state = '../active'\nreturn function() return next_state end",
	});
	const document = buildBehaviorSourceDocument({ domain: 0, path: 'main.lua' }, project.getSnapshot());
	for (const definition of document.definitions) {
		assert.ok(definition.behaviorKind === 'state_machine');
		const transition = definition.transitions.find(item => item.slot.kind === 'update')!;
		const outcome = transition.outcomes[0];
		assert.ok(outcome.proof.kind === 'return' && outcome.target.kind === 'path');
		assert.equal(outcome.proof.binding.range.path, 'states.lua');
		assert.equal(outcome.proof.statement.range.path, 'callback.lua');
		assert.equal(outcome.value?.range.path, 'callback.lua');
		assert.equal(outcome.target.target, definition.scopes.find(scope => scope.name === 'active')!.rowKey);
	}
});

test('competing and unknown origins never choose the one known constructor', () => {
	for (const source of [
		"local value = { root = { type = 'wait' } }; value = make_definition(); return value",
		"local value = { root = { type = 'wait' } }; value = { root = { type = 'task' } }; return value",
		"if condition then return {} end; return { root = { type = 'wait' } }",
	]) {
		const project = workspace({ 'main.lua': main, 'definition.lua': source });
		const definition = buildBehaviorSourceDocument({ domain: 0, path: 'main.lua' }, project.getSnapshot()).definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree');
		assert.equal(definition.root, null);
		assert.equal(definition.resolution, 'unresolved');
	}
});

test('recovered provider syntax is incomplete even when the registering document parses completely', () => {
	const project = workspace({ 'main.lua': main, 'definition.lua': provider + '\nlocal broken =' });
	const document = buildBehaviorSourceDocument({ domain: 0, path: 'main.lua' }, project.getSnapshot());
	assert.equal(document.syntaxComplete, false);
	assert.equal(document.definitions[0].resolution, 'partial');
	assert.match(document.definitions[0].detail, /syntax recovery/);
});

test('writes through another import or a captured alias retain source mutation evidence', () => {
	for (const mutation of [
		"local value = require('definition'); value.root = replacement",
		"local value = require('definition'); local alias = value; local function change() alias[key] = replacement end",
		"local value = require('definition'); setmetatable(value, metadata)",
	]) {
		const project = workspace({ 'main.lua': main, 'definition.lua': provider, 'mutation.lua': mutation });
		const definition = buildBehaviorSourceDocument({ domain: 0, path: 'main.lua' }, project.getSnapshot()).definitions[0];
		assert.equal(definition.resolution, 'partial');
		assert.match(definition.detail, /known table mutation/);
		const query = project.getSnapshot().symbolResolver.writtenSources;
		assert.equal(query.tableMutations(), query.tableMutations());
	}
});

test('cyclic authored BT/FSM source becomes an unresolved occurrence, not recursive projection', () => {
	for (const source of [
		"local trees<const> = require('cartlib/behaviour_tree/library'); local root; root = { type = 'sequence', children = { root } }; trees.register('cycle', { root = root })",
		"local fsm<const> = require('cartlib/fsm/library'); local body<const> = { states = {} }; body.states.self = body; fsm.register('cycle', body)",
	]) {
		const project = workspace({ 'main.lua': source });
		const document = buildBehaviorSourceDocument({ domain: 0, path: 'main.lua' }, project.getSnapshot());
		assert.notEqual(document.definitions[0].resolution, 'complete');
	}
});

test('an imported effect owns its list and scalar fields; source edit and Undo refresh every reader', t => {
	editorViewState.font = new EditorFont('tiny');
	const code = "local effects<const> = require('cartlib/actioneffects'); effects.register_effect('imported', require('definition'))";
	const effect = "return { period_ms = 40, blocked_tags = { 'busy' }, handler = function(owner) owner:act() end }";
	const models = new Map(Object.entries({ 'main.lua': code, 'definition.lua': effect }).map(([path, source]) =>
		[path, new EditorTextModel({ domain: 0, path, source: { type: 'lua', resid: path } }, 'lua', source)]));
	t.after(() => { for (const model of models.values()) model.dispose(); });
	const project = workspace({ 'main.lua': code, 'definition.lua': effect });
	const mainModel = models.get('main.lua')!, sourceModel = models.get('definition.lua')!;
	const document = () => buildBehaviorSourceDocument(mainModel.identity, project.getSnapshot());
	const view = createBehaviorLensViewState(document(), mainModel, 'properties', path => models.get(path)!);
	t.after(() => view.source.release());
	const definition = view.document.definitions[0];
	assert.ok(definition.behaviorKind === 'action_effect' && definition.body !== null);
	assert.ok(view.presentation.kind === 'properties');
	projectActionEffectProperties(view, view.presentation, definition);
	assert.equal(definition.body.issues, SourceTableIssue.None);
	const duration = definition.body.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	assert.equal(duration.field.range.path, 'definition.lua');
	view.selection = { kind: 'node', rowKey: duration.source.rowKey };
	assert.ok(buildBehaviorInspection(view).some(item => item.value.includes('40')));
	assert.equal(mainModel.dirty, false); assert.equal(sourceModel.dirty, false);
	assert.equal(mainModel.canUndo, false); assert.equal(sourceModel.canUndo, false);
	const offset = effect.indexOf('40');
	sourceModel.pushEditOperations([{ offset, deleteLength: 2, text: '80' }]);
	assert.equal(view.source.isCurrent, false);
	project.updateFile('definition.lua', sourceModel.buffer.getText());
	installBehaviorLensDocument(view, document());
	const changed = view.document.definitions[0];
	assert.ok(changed.behaviorKind === 'action_effect' && changed.body !== null);
	const changedDuration = changed.body.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	assert.equal(readLuaSourceRange(sourceModel.buffer, changedDuration.field.value.range), '80');
	assert.equal(mainModel.version, 1);
	sourceModel.undo(); project.updateFile('definition.lua', sourceModel.buffer.getText());
	installBehaviorLensDocument(view, document());
	assert.equal(sourceModel.buffer.getText(), effect); assert.equal(sourceModel.dirty, false);
	const statement = project.getFileData('definition.lua')!.chunk.body[0];
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
});
