import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { indexStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_index';
import { setStateMachineInitial } from '../../ide/workbench/contrib/behavior_lens/state_machine_initial';
import { FSM_INITIAL_SOURCE } from '../helpers/fsm_initial_fixture';

function fixture(t: TestContext, source = FSM_INITIAL_SOURCE) {
	const resource = { domain: 0 as const, path: 'initial.lua', source: { type: 'lua' as const, resid: 'initial' } };
	const model = new EditorTextModel(resource, 'lua', source);
	t.after(() => model.dispose());
	const document = buildBehaviorSourceDocument(resource, buildLuaFileSemanticData(source, resource.path));
	const index = indexStateMachineSource(document);
	return { model, document, index };
}

test('initial editing changes the real parent constructor, including all its shared occurrences', t => {
	const f = fixture(t);
	const active = [...f.index.initialTargets.values()].filter(target => target.name === 'active');
	assert.equal(active.length, 3);
	assert.equal(active[0].owner.table, active[2].owner.table);
	assert.equal(f.index.initialTargets.size, 4, 'three shared active states and the first registration right child');
	let events = 0;
	f.model.onDidChangeContent(() => { events += 1; });
	setStateMachineInitial(f.model, active[0]);
	assert.equal(events, 1);
	assert.equal(f.model.buffer.getText(), FSM_INITIAL_SOURCE.replace("'idle'),", "'active'),"));
	const changed = buildBehaviorSourceDocument(f.model.resource, buildLuaFileSemanticData(f.model.buffer.getText(), 'initial.lua'));
	const updated = indexStateMachineSource(changed);
	assert.equal([...updated.initialTargets.values()].filter(target => target.name === 'idle').length, 3);
	assert.equal([...updated.initialTargets.values()].filter(target => target.name === 'active').length, 0, 'already explicit initial is no-op');
	f.model.undo();
	assert.equal(f.model.buffer.getText(), FSM_INITIAL_SOURCE);
	f.model.redo();
	assert.equal(f.model.buffer.getText(), FSM_INITIAL_SOURCE.replace("'idle'),", "'active'),"));
});

test('missing and scalar initial values are explicitly authored without inventing implicit guest order', t => {
	for (const initial of ['', 'initial=nil,', 'initial=(--[[value]] false),', 'initial=true,', 'initial=7,']) {
		const source = `local machines<const> = require('cartlib/fsm/library')\nmachines.register('empty',{${initial} states={a={}, b={}}})`;
		const f = fixture(t, source);
		assert.equal(f.index.initialTargets.size, 2);
		setStateMachineInitial(f.model, [...f.index.initialTargets.values()].find(target => target.name === 'b')!);
		const result = buildBehaviorSourceDocument(f.model.resource, buildLuaFileSemanticData(f.model.buffer.getText(), 'initial.lua'));
		const definition = result.definitions[0];
		assert.ok(definition.behaviorKind === 'state_machine');
		assert.equal(definition.entries[0].target.kind, 'state');
		assert.equal(indexStateMachineSource(result).initialTargets.size, 1);
		if (initial.includes('value')) assert.ok(f.model.buffer.getText().includes("initial=(--[[value]] 'b')"));
		f.model.undo(); assert.equal(f.model.buffer.getText(), source);
	}
});

test('initial uses exact arbitrary string keys rather than transition path syntax or key prefixes', t => {
	for (const key of ['a/b', '.', '..', '_start', '#entry', '', "a'\\\"b\n\0" + '123', '雪']) {
		const quote = (text: string) => '[====[' + text + ']====]';
		const source = `local machines<const> = require('cartlib/fsm/library')\nmachines.register('keys',{initial='other',states={other={},[ ${quote(key)} ]={}}})`;
		const f = fixture(t, source);
		const target = [...f.index.initialTargets.values()].find(target => target.name === key)!;
		assert.ok(target, JSON.stringify(key));
		setStateMachineInitial(f.model, target);
		const result = buildBehaviorSourceDocument(f.model.resource, buildLuaFileSemanticData(f.model.buffer.getText(), 'initial.lua'));
		const definition = result.definitions[0];
		assert.ok(definition.behaviorKind === 'state_machine' && definition.entries[0].target.kind === 'state');
		assert.equal(indexStateMachineSource(result).initialTargets.size, 1);
		f.model.undo(); assert.equal(f.model.buffer.getText(), source);
	}
});

test('overwritten child keys are source occurrences, not eligible runtime children', t => {
	const f = fixture(t, `local machines<const> = require('cartlib/fsm/library')
machines.register('duplicate',{states={a={initial='inner',states={inner={}}}, ['a']={}}})`);
	const definition = f.document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine' && definition.body?.states?.kind === 'resolved');
	const entries = definition.body.states.entries;
	assert.equal(entries.length, 1, 'the existing named-field producer excludes the overwritten occurrence');
	assert.equal(f.index.initialTargets.has(entries[0].node.rowKey), true);
	assert.equal(f.index.initialTargets.size, 1);
});

test('local topology uncertainty and arbitrary initial expressions are not hidden by graph editing', t => {
	for (const body of ["initial=choose(), states={a={}}", "initial=DEFAULT, states={a={}}", "initial=-7, states={a={}}",
		"states=make_states()", "states={[key]={},a={}}", "states={[1]={},a={}}", "[key]=something,states={a={}}",
		"states={a=make_state()}"]) {
		const f = fixture(t, `local machines<const> = require('cartlib/fsm/library')\nmachines.register('unknown',{${body}})`);
		assert.equal(f.index.initialTargets.size, 0, body);
		assert.equal(f.model.dirty, false);
	}
	for (const mutation of ['definition.initial=next_initial', 'states.b={}']) {
		const f = fixture(t, `local machines<const> = require('cartlib/fsm/library')
local states<const> ={a={}}
local definition<const> ={states=states}
machines.register('mutated',definition)
${mutation}`);
		assert.equal(f.index.initialTargets.size, 0);
	}
});

test('unrelated callbacks, numeric parent metadata and concurrency retain exact editable membership', t => {
	const f = fixture(t, `local machines<const> = require('cartlib/fsm/library')
machines.register('known',{[1]='metadata',states={a={update=callbacks.dynamic}, b={is_concurrent=true, states=make_states()}}})`);
	assert.equal(f.index.initialTargets.size, 2);
	const target = [...f.index.initialTargets.values()].find(target => target.name === 'b')!;
	setStateMachineInitial(f.model, target);
	assert.ok(f.model.buffer.getText().includes('is_concurrent=true'));
	assert.ok(f.model.buffer.getText().includes("initial = 'b'"));
});
