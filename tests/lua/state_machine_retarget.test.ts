import { semanticSnapshot } from './semantic_test_harness';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaStringValueEdit } from '../../ide/language/lua/source_edits';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { StateMachineRetargetAnalysis } from '../../ide/workbench/contrib/behavior_lens/state_machine_retarget';
import type { StateMachineScope } from '../../ide/workbench/contrib/behavior_lens/state_machine_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { createFsmStatePath, parseFsmStatePath } from '../../toolchain/ts/cartlib/fsm/state_path';
import { FSM_RETARGET_PATH_CASES, FSM_RETARGET_PATH_SOURCE, FSM_RETARGET_SOURCE } from '../helpers/fsm_retarget_fixture';

function fixture(t: TestContext, source = FSM_RETARGET_SOURCE) {
	const resource = { domain: 0 as const, path: 'retarget.lua', source: { type: 'lua' as const, resid: 'retarget' } };
	const model = new EditorTextModel(resource, 'lua', source);
	t.after(() => model.dispose());
	const document = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)));
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine');
	return { model, document, definition, root: definition.scopes[0] };
}

function scopeAt(root: StateMachineScope, keys: readonly string[]): StateMachineScope {
	let scope = root;
	for (const key of keys) scope = scope.children.get(key)!;
	return scope;
}

test('path formatting distinguishes exact child keys, navigation operators, and the no_op sentinel', () => {
	for (const key of ['idle', '_idle', '#idle', 'a/b', "quote'\\", "['brackets']", 'no_op', 'é雪🎮', '\0' + '123', '\n']) {
		const path = createFsmStatePath(false, 1, [key])!;
		assert.deepEqual(parseFsmStatePath(path.text), path);
		assert.deepEqual(path.segments, ['..', key]);
	}
	for (const key of ['', '.', '..']) assert.equal(createFsmStatePath(true, 0, [key]), undefined);
	assert.equal(createFsmStatePath(false, 0, []), undefined);
	assert.equal(createFsmStatePath(false, 2, [])!.text, '../../');
	assert.equal(createFsmStatePath(true, 0, [])!.text, '/');
	const aboveRoot = createFsmStatePath(true, 1, ['idle'])!;
	assert.deepEqual(parseFsmStatePath(aboveRoot.text), aboveRoot, 'representation does not silently discard upward operators');
	assert.notEqual(createFsmStatePath(false, 0, ['no_op'])!.text, 'no_op');
});

test('retargeting preserves explicit anchors, widens only as needed, and emits exact runtime path steps', t => {
	const f = fixture(t, FSM_RETARGET_PATH_SOURCE);
	for (const expected of FSM_RETARGET_PATH_CASES) {
		const origin = scopeAt(f.root, expected.origin);
		const transition = f.definition.transitions.find(item => item.origin === origin && item.slot.source.label === expected.event)!;
		const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[0]);
		const target = scopeAt(f.root, expected.target);
		const result = analysis.checkTarget(target);
		assert.ok(result.kind === 'available', expected.text);
		assert.equal(result.text, expected.text);
		const plan = result.uses[0].plan;
		assert.equal(plan.absolute, expected.absolute);
		assert.equal(plan.up, expected.up);
		assert.equal(plan.target, target.rowKey);
		assert.deepEqual(plan.steps.map(step => [f.definition.scopes.find(scope => scope.rowKey === step.target)!.name, step.concurrent]), expected.steps);
		for (let repeat = 0; repeat < 100; repeat += 1) assert.equal(analysis.checkTarget(target), result);
	}
	assert.equal(f.model.dirty, false, 'the analysis does not edit source or guest state');
});

test('target switching retains only current evidence instead of a candidates-by-consumers cache', t => {
	const f = fixture(t, FSM_RETARGET_PATH_SOURCE);
	const transition = f.definition.transitions[0];
	const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[0]);
	const first = scopeAt(f.root, ['room', 'active']);
	const second = scopeAt(f.root, ['idle']);
	const original = analysis.checkTarget(first);
	assert.equal(analysis.checkTarget(first), original);
	const changed = analysis.checkTarget(second);
	assert.equal(analysis.checkTarget(second), changed);
	const revisited = analysis.checkTarget(first);
	assert.notEqual(revisited, original);
	assert.deepEqual(revisited, original);
});

test('one literal edit covers actual shared consumers but not identical return text', t => {
	const f = fixture(t);
	const origin = scopeAt(f.root, ['left', 'idle']);
	const transition = f.definition.transitions.find(item => item.origin === origin && item.slot.kind === 'update')!;
	const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[1]);
	assert.equal(analysis.uses.length, 3);
	assert.ok(analysis.uses.every(use => use.outcome.value === transition.outcomes[1].value));
	const check = analysis.checkTarget(scopeAt(f.root, ['left', 'other']));
	assert.ok(check.kind === 'available');
	assert.equal(check.text, '../other');
	assert.equal(new Set(check.uses.map(use => use.plan.target)).size, 3, 'shared text does not merge source occurrences');
	assert.deepEqual(check.uses.map(use => use.plan.target), analysis.uses.map(use => scopeAt(use.transition.origin.parent!, ['other']).rowKey));
	f.model.pushEditOperations([createLuaStringValueEdit(f.model.buffer, check.literal, check.text)]);
	assert.equal(f.model.buffer.getText(), FSM_RETARGET_SOURCE.replace("--[[selected return]] '../active'", "--[[selected return]] '../other'"));
	f.model.undo(); assert.equal(f.model.buffer.getText(), FSM_RETARGET_SOURCE);
	f.model.redo(); assert.ok(f.model.buffer.getText().includes("if actor.first then return '../active', 'ignored result' end"));
});

test('direct and go-table fields preserve wrappers and metadata, while aliases remain explicit source', t => {
	const f = fixture(t);
	const origin = scopeAt(f.root, ['left', 'idle']);
	for (const name of ['direct', 'wrapped', 'aliased']) {
		const transition = f.definition.transitions.find(item => item.origin === origin && item.slot.source.label === name)!;
		const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[0]);
		const check = analysis.checkTarget(scopeAt(f.root, ['left', 'other']));
		if (name === 'aliased') { assert.deepEqual(check, { kind: 'unavailable', reason: 'indirect-literal' }); continue; }
		assert.ok(check.kind === 'available');
		assert.equal(check.uses.length, 3);
		f.model.pushEditOperations([createLuaStringValueEdit(f.model.buffer, check.literal, check.text)]);
		assert.equal(f.model.buffer.getText(), FSM_RETARGET_SOURCE.replace(`--[[${name} path]] '../active'`, `--[[${name} path]] '../other'`));
		f.model.undo(); assert.equal(f.model.buffer.getText(), FSM_RETARGET_SOURCE);
	}
});

test('shared return evidence survives incomplete consumers and prevents a partial retarget', t => {
	for (const states of ['{ idle={}, [key]={} }', 'dynamic_states', '{ idle=make_state() }']) {
		const source = `local machines<const> = require('cartlib/fsm/library')
local go<const> = function() return 'idle' end
machines.register('complete',{on={go=go},states={idle={},active={}}})
machines.register('partial',{on={go=go},states=${states}})`;
		const f = fixture(t, source);
		const transition = f.definition.transitions[0];
		const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[0]);
		assert.equal(analysis.uses.length, 2, states);
		const partial = analysis.uses[1].outcome;
		assert.equal(partial.proof.kind, 'return', 'incomplete target binding must not erase known callback syntax');
		assert.equal(partial.value, transition.outcomes[0].value);
		const result = analysis.checkTarget(scopeAt(f.root, ['active']));
		assert.ok(result.kind === 'unresolved-consumer', states);
		assert.equal(result.use, analysis.uses[1]);
		assert.equal(f.model.dirty, false);
	}
});

test('candidate checks expose dangling shared paths instead of selecting a namesake or updating just one use', t => {
	const f = fixture(t, `local machines<const> = require('cartlib/fsm/library')
local go<const> = function() return 'idle' end
machines.register('complete',{on={go=go},states={idle={},active={}}})
machines.register('other',{on={go=go},states={idle={}}})`);
	const transition = f.definition.transitions[0];
	const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[0]);
	const result = analysis.checkTarget(scopeAt(f.root, ['active']));
	assert.ok(result.kind === 'unresolved-consumer');
	assert.deepEqual(result.target, { kind: 'unresolved', reason: 'missing-state' });
	const other = f.document.definitions[1];
	assert.ok(other.behaviorKind === 'state_machine');
	assert.deepEqual(analysis.checkTarget(other.scopes[0]), { kind: 'unavailable', reason: 'different-registration' });
});

test('no-op targets, recovery, unresolved sources and unrepresentable keys do not create edits', t => {
	const f = fixture(t, FSM_RETARGET_PATH_SOURCE);
	const transition = f.definition.transitions[0];
	const analysis = new StateMachineRetargetAnalysis(f.document, transition, transition.outcomes[0]);
	assert.deepEqual(analysis.checkTarget(scopeAt(f.root, ['room', 'idle'])), { kind: 'unchanged' });
	for (const target of [f.root, ...['', '.', '..'].map(key => scopeAt(f.root, [key]))]) {
		assert.deepEqual(analysis.checkTarget(target), { kind: 'unavailable', reason: 'unaddressable-target' });
	}
	const recovery = fixture(t, FSM_RETARGET_SOURCE + '\n@');
	const broken = recovery.definition.transitions[0];
	assert.deepEqual(new StateMachineRetargetAnalysis(recovery.document, broken, broken.outcomes[0]).checkTarget(recovery.root),
		{ kind: 'unavailable', reason: 'syntax-incomplete' });
	const unresolved = fixture(t, "local machines<const> = require('cartlib/fsm/library')\nmachines.register('unknown',{on={go='/missing'},states={idle={}}})");
	const unknown = unresolved.definition.transitions[0];
	assert.deepEqual(new StateMachineRetargetAnalysis(unresolved.document, unknown, unknown.outcomes[0]).checkTarget(unresolved.root),
		{ kind: 'unavailable', reason: 'source-not-path' });
});
