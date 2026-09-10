import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import type { BehaviorSourceNode } from '../../ide/workbench/contrib/behavior_lens/model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { collectConstInitializers, collectMutatedDeclarations, type BehaviorRecognizerContext } from '../../ide/workbench/contrib/behavior_lens/source';
import type { StateMachineSourceDefinition, StateMachineSourceState } from '../../ide/workbench/contrib/behavior_lens/state_machine_model';
import { bindStateMachineSourcePath, indexStateMachineScopes } from '../../ide/workbench/contrib/behavior_lens/state_machine_scope';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { parseFsmStatePath } from '../../toolchain/ts/cartlib/fsm/state_path';
import type { LuaStringLiteralExpression } from '../../toolchain/ts/lua/syntax/ast';
import { FSM_BEHAVIOR_SOURCE, FSM_PATH_CASES, FSM_SCOPE_SOURCE } from '../helpers/fsm_source_fixture';

function fixture(source = FSM_BEHAVIOR_SOURCE) {
	const resource = { domain: 0 as const, path: 'fsm_fixture.lua',
		source: { resid: 'fsm_fixture', type: 'lua' as const, source_path: 'fsm_fixture.lua', generated: false } };
	const model = new EditorTextModel(resource, 'lua', source);
	const analysis = buildLuaFileSemanticData(source, resource.path);
	const document = buildBehaviorSourceDocument(resource, analysis);
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine');
	return { model, analysis, document, definition, read: (node: { range: LuaStringLiteralExpression['range'] }) => readLuaSourceRange(model.buffer, node.range) };
}

function stateAt(root: StateMachineSourceDefinition | StateMachineSourceState, ...keys: string[]): StateMachineSourceDefinition | StateMachineSourceState {
	let state = root;
	for (const key of keys) {
		const children = state.body!.states!;
		assert.ok(children.kind === 'resolved');
		const child = children.entries.find(entry => entry.name === key)!.node;
		assert.ok(child.kind === 'state');
		state = child;
	}
	return state;
}

function context(f: ReturnType<typeof fixture>): BehaviorRecognizerContext {
	return { analysis: f.analysis, constInitializers: collectConstInitializers(f.analysis), mutatedDeclarations: collectMutatedDeclarations(f.analysis),
		anchor: '', registrationRange: f.definition.occurrenceRange, sourceIncomplete: f.analysis.syntaxError !== null, behaviorKind: 'state_machine' };
}

test('FSM containment, guards and transitions refer to the same authored occurrences, not names or outline labels', () => {
	const f = fixture();
	const root = f.definition;
	const left = stateAt(root, 'left');
	const right = stateAt(root, 'right');
	const idle = stateAt(root, 'left', 'idle');
	const otherIdle = stateAt(root, 'right', 'idle');
	assert.equal(left.authoredRange, right.authoredRange);
	assert.notDeepEqual(left.occurrenceRange, right.occurrenceRange);
	assert.notEqual(idle.rowKey, otherIdle.rowKey);
	const nodes = new Map<string, BehaviorSourceNode>();
	function visit(node: BehaviorSourceNode) { nodes.set(node.rowKey, node); for (const child of node.children) visit(child); }
	visit(root);
	assert.equal(nodes.get(idle.rowKey), idle);
	const body = idle.body!;
	assert.equal(nodes.get(body.guards!.source.rowKey), body.guards!.source);
	assert.equal(f.read(body.guards!.canEnter!.value), 'checks.enter');
	assert.equal(f.read(body.guards!.canExit!.value), 'checks.exit');
	assert.equal(root.entries.find(entry => entry.kind === 'initial' && entry.origin === root.rowKey)!.target.kind, 'state');
	for (const side of ['left', 'right']) {
		const child = stateAt(root, side, 'idle');
		const active = stateAt(root, side, 'active');
		const transitions = root.transitions.filter(transition => transition.origin.rowKey === child.rowKey);
		assert.deepEqual(transitions.map(transition => transition.slot.kind), ['update', 'enter', 'event', 'event', 'timeline-finished', 'input']);
		for (const transition of transitions) {
			assert.equal(nodes.get(transition.slot.source.rowKey), transition.slot.source);
			const paths = transition.outcomes.filter(outcome => outcome.target.kind === 'path');
			assert.equal(paths.length, 1);
			const path = paths[0].target;
			assert.ok(path.kind === 'path');
			assert.equal(path.target, active.rowKey);
			assert.deepEqual(path.steps, [{ scope: stateAt(root, side).rowKey, target: active.rowKey, concurrent: false }]);
			assert.equal(path.up, 1);
		}
		// Parent event propagation does not invent an edge from each descendant.
		const reset = root.transitions.filter(transition => transition.slot.source.label === 'reset' && transition.origin.rowKey === stateAt(root, side).rowKey);
		assert.equal(reset.length, 1);
		assert.equal(reset[0].outcomes[0].target.kind, 'path');
	}
	assert.equal(root.transitions.some(transition => transition.origin.rowKey === root.rowKey), false, 'root enter is not invoked by start');
	const update = root.transitions.find(transition => transition.origin.rowKey === idle.rowKey && transition.slot.kind === 'update')!;
	assert.deepEqual(update.outcomes.map(outcome => outcome.target.kind), ['path', 'no-path']);
	const proof = update.outcomes[0].proof;
	assert.ok(proof.kind === 'return');
	assert.equal(f.read(proof.binding), 'step');
	assert.equal(f.read(proof.statement), "return next_path, '/ignored-second-result'");
	assert.ok(f.read(proof.callback).startsWith('function(owner)'));
	const timeline = root.transitions.find(transition => transition.origin.rowKey === idle.rowKey && transition.slot.kind === 'timeline-finished')!;
	assert.ok(f.read({ range: timeline.slot.source.occurrenceRange }).startsWith('[clips.intro] = {'),
		'the timeline declaration owns its source range, including the computed key');
	assert.ok(timeline.outcomes[0].proof.kind === 'return');
	assert.equal(f.read(timeline.outcomes[0].proof.binding), 'step');
	assert.equal(f.document.definitions[1].behaviorKind, 'state_machine');
});

test('FSM source binding follows cartlib path plans, including relative origins, aliases, quotes and concurrent descents', () => {
	const f = fixture(FSM_SCOPE_SOURCE + "machines.register('fixture.paths', blueprint)\n");
	const scopes = indexStateMachineScopes(context(f), f.definition.rowKey, f.definition.body!);
	for (const expected of FSM_PATH_CASES) {
		const origin = stateAt(f.definition, ...expected.origin);
		const actual = bindStateMachineSourcePath(scopes[0], scopes.find(scope => scope.rowKey === origin.rowKey)!, parseFsmStatePath(expected.path));
		assert.ok(actual.kind === 'path', expected.path);
		assert.equal(actual.absolute, expected.absolute, expected.path);
		assert.equal(actual.up, expected.up, expected.path);
		assert.equal(actual.target, stateAt(f.definition, ...expected.target).rowKey, expected.path);
		const names = actual.steps.map(step => {
			const parent = scopes.find(scope => scope.rowKey === step.scope)!;
			const child = [...parent.children].find(([, scope]) => scope !== null && scope.rowKey === step.target)!;
			return [child[0], step.concurrent];
		});
		assert.deepEqual(names, expected.steps, expected.path);
	}
	for (const [path, reason] of [
		['', 'empty-path'], ['.', 'empty-path'], ['room/..', 'empty-path'], ['..', 'above-root'],
		['room/../../idle', 'above-root'], ['missing/../room', 'missing-state'], ["['unclosed", 'unterminated-quoted-segment'],
		["['room'x", 'unterminated-quoted-segment'], ['fixture.paths:/room', 'missing-state'],
	]) {
		assert.deepEqual(bindStateMachineSourcePath(scopes[0], scopes[0], parseFsmStatePath(path)), { kind: 'unresolved', reason }, path);
	}
});

test('FSM callback results are analyzed only at consumer slots and binder-proven local const functions', () => {
	const f = fixture(`local machines<const> = require('cartlib/fsm/library')
local callable<const> = function() return '/active' end
local alias<const> = callable
local mutable = function() return '/active' end
machines.register('callbacks', { states = { idle = { on = {
	const_alias = { go = alias }, member = callbacks.callable, mutable = mutable,
	no_op = 'no_op', invalid_false = false, nested_table = { go = { go = '/active' } }, missing_go = {},
	empty = function() local nested<const> = function() return '/active' end end,
	results = function(owner)
		if owner.one then return end
		if owner.two then return false end
		if owner.three then return 'no_op' end
		return owner.path
	end,
}, update = '/active', entering_state = { go = '/active' }, exiting_state = alias }, active = {} } })`);
	const transitions = f.definition.transitions;
	const event = (name: string) => transitions.find(item => item.slot.kind === 'event' && item.slot.source.label === name)!;
	assert.equal(event('const_alias').outcomes[0].target.kind, 'path');
	for (const name of ['member', 'mutable']) assert.deepEqual(event(name).outcomes[0].target, { kind: 'unresolved', reason: 'unknown-callback' });
	for (const name of ['invalid_false', 'nested_table', 'missing_go']) assert.deepEqual(event(name).outcomes[0].target, { kind: 'unresolved', reason: 'invalid-value' });
	assert.deepEqual(event('empty').outcomes[0].target, { kind: 'no-path', reason: 'no-return' });
	assert.deepEqual(event('no_op').outcomes[0].target, { kind: 'no-path', reason: 'no-op' });
	assert.deepEqual(event('results').outcomes.map(outcome => outcome.target), [
		{ kind: 'no-path', reason: 'no-return' }, { kind: 'no-path', reason: 'false' }, { kind: 'no-path', reason: 'no-op' }, { kind: 'unresolved', reason: 'dynamic-value' },
	]);
	for (const slot of ['enter', 'update']) assert.deepEqual(transitions.find(item => item.slot.kind === slot)!.outcomes[0].target, { kind: 'unresolved', reason: 'invalid-value' });
});

test('FSM entries use exact initial keys and Lua truth; implicit guest pairs order stays unknown', () => {
	const f = fixture(`local machines<const> = require('cartlib/fsm/library')
local first<const> = 'idle'
local flag<const> = ''
machines.register('entries', { initial = first, states = {
	idle = {}, _alias = {},
	implicit = { states = { idle = {}, _preferred = {} } },
	exact = { initial = 'idle', states = { _idle = {} } },
	concurrent = { is_concurrent = flag }, conditional = { is_concurrent = owner.enabled },
} })`);
	const root = f.definition;
	const entryAt = (origin: string, kind: 'initial' | 'concurrent') => root.entries.find(entry => entry.origin === origin && entry.kind === kind)!;
	assert.deepEqual(entryAt(root.rowKey, 'initial').target, { kind: 'state', rowKey: stateAt(root, 'idle').rowKey });
	assert.deepEqual(entryAt(stateAt(root, 'implicit').rowKey, 'initial').target, { kind: 'unresolved', reason: 'implicit-initial' });
	assert.deepEqual(entryAt(stateAt(root, 'exact').rowKey, 'initial').target, { kind: 'unresolved', reason: 'missing-state' });
	const concurrent = root.entries.filter(entry => entry.kind === 'concurrent');
	assert.deepEqual(concurrent.map(entry => entry.target), [{ kind: 'state', rowKey: stateAt(root, 'concurrent').rowKey }, { kind: 'unresolved', reason: 'dynamic-value' }]);
});

test('FSM incomplete membership, known mutations and unresolved child bodies never manufacture target scopes', () => {
	for (const [source, expected] of [
		["{ states = { {}, idle = {} }, on = { go = 'idle' } }", 'unknown-states'],
		["{ states = { idle = {}, [key] = {} }, on = { go = 'idle' } }", 'unknown-states'],
		["{ states = { idle = create_state(), _idle = {} }, on = { go = 'idle' } }", 'unknown-states'],
		["{ states = dynamic_states, on = { go = 'idle' } }", 'unknown-states'],
		["{ states = { idle = {} }, on = { go = { go = 'idle', [key] = dynamic_value } } }", 'partial-source'],
	]) {
		const f = fixture(`local machines<const> = require('cartlib/fsm/library')\nmachines.register('partial', ${source})`);
		assert.deepEqual(f.definition.transitions[0].outcomes[0].target, { kind: 'unresolved', reason: expected });
	}
	for (const mutation of ['blueprint.states.idle = {}', "handlers.go = '/missing'", "spec.go = '/missing'"]) {
		const f = fixture(`local machines<const> = require('cartlib/fsm/library')
local spec<const> = { go = 'idle' }
local handlers<const> = { go = spec }
local blueprint<const> = { states = { idle = {} }, on = handlers }
${mutation}
machines.register('mutated', blueprint)`);
		assert.deepEqual(f.definition.transitions[0].outcomes[0].target, { kind: 'unresolved', reason: 'partial-source' });
	}
	const syntax = fixture(FSM_BEHAVIOR_SOURCE + 'local broken = ');
	assert.ok(syntax.analysis.syntaxError !== null);
	for (const transition of syntax.definition.transitions) assert.deepEqual(transition.outcomes[0].target, { kind: 'unresolved', reason: 'partial-source' });
	const dynamic = fixture("local machines<const> = require('cartlib/fsm/library')\nmachines.register('dynamic', factory())");
	assert.equal(dynamic.definition.body, null);
	assert.deepEqual(dynamic.definition.transitions, []);
});

test('FSM registration, lexical shadowing and duplicate state keys preserve scope identity', () => {
	const f = fixture(`local machines<const> = require('cartlib/fsm/library')
local go<const> = function() return '/outer' end
machines.register('one', { on = { go = go }, states = { outer = {} } })
do
	local go<const> = function() return '/inner' end
	local states<const> = { inner = { on = { ignored = '/absent' } }, inner = {} }
	machines.register('two', { on = { go = go }, states = states })
end`);
	assert.equal(f.document.definitions.length, 2);
	for (let index = 0; index < 2; index += 1) {
		const definition = f.document.definitions[index];
		assert.ok(definition.behaviorKind === 'state_machine');
		assert.equal(definition.transitions.length, 1);
		const path = definition.transitions[0].outcomes[0].target;
		assert.ok(path.kind === 'path');
		assert.equal(path.target, stateAt(definition, index === 0 ? 'outer' : 'inner').rowKey);
	}
});

test('FSM absent slots differ from an invalid callback inside a present transition spec', () => {
	const f = fixture(`local machines<const> = require('cartlib/fsm/library')
local absent<const> = nil
machines.register('slots', { states = {
	idle = { entering_state = false, update = absent, on = { absent = absent, bad = { go = absent } },
		timelines = { intro = { on_finished = absent } } },
	active = { update = false },
} })`);
	const transitions = f.definition.transitions;
	const idle = stateAt(f.definition, 'idle');
	for (const transition of transitions.filter(transition => transition.origin.rowKey === idle.rowKey)) {
		assert.deepEqual(transition.outcomes[0].target, transition.slot.source.label === 'bad'
			? { kind: 'unresolved', reason: 'invalid-value' }
			: { kind: 'no-path', reason: transition.slot.kind === 'enter' ? 'false' : 'nil' });
	}
	const active = stateAt(f.definition, 'active');
	assert.deepEqual(transitions.find(transition => transition.origin.rowKey === active.rowKey)!.outcomes[0].target,
		{ kind: 'unresolved', reason: 'invalid-value' });
});
