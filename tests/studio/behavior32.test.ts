import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, asInteger, isNil, ValueTag } from '../../machine/ts/machine/cpu/value';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createBlua32SourceImage } from '../../ide/runtime/sources';
import { compiledBlua32Sources } from '../../toolchain/ts/rompack/blua32_sources';
import { findActionEffectInstance, inspectActionEffectInstance, readActionEffectInstances } from '../../ide/workbench/contrib/behavior_lens/action_effect_runtime';
import { inspectBehaviorTreeInstance, readBehaviorTreeInstances } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_runtime';
import { readBehaviorDefinitions } from '../../ide/workbench/contrib/behavior_lens/runtime_definitions';
import { findStateMachineState, inspectStateMachineState, readStateMachineDefinitionStates, readStateMachineInstances, readStateMachineStates } from '../../ide/workbench/contrib/behavior_lens/state_machine_runtime';
import { compileCartlibProgram } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { runCompletionClosure } from '../helpers/cpu_test_harness';
import { afterTest } from '../helpers/test_cleanup';

const ENTRY = `
local registry<const> = require('cartlib/registry')
local machines<const> = require('cartlib/fsm/fsm_component')
local fsm<const> = require('cartlib/fsm/library')
local trees<const> = require('cartlib/behaviour_tree/bt_component')
local bt<const> = require('cartlib/behaviour_tree/library')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local effects<const> = require('cartlib/actioneffects/actioneffect_component')
callbacks=0
local owner<const> = {id=16777217,active=true,tags={},world={gameplay_time_ms=0}}
fsm.register('live', {initial='idle',states={idle={},moving={}}})
fsm.register('unused', {states={}})
local machine<const> = machines.new(owner, {'live'})
machine.id='machine'; registry:register(machine); registry:index(machine,machines)
local first<const>,last<const> = blackboard.key('answer',0),blackboard.key('answer',0.25)
bt.register('board', {blackboard={first,last,blackboard.key('big',16777217),blackboard.key('unset'),blackboard.key(1,2),blackboard.key(1.0,4)},root={type='sequence',children={}}})
bt.register('bare', {root={type='sequence',children={}}})
local tree<const> = trees.new(owner,'board')
tree.id='tree'; registry:register(tree); registry:index(tree,trees)
local bare<const> = trees.new(owner,'bare')
bare.id='bare'; registry:register(bare); registry:index(bare,trees)
local definition<const> = {cooldown_ms=16777217,initial_cooldown_ms=0,
 handler=function() callbacks=callbacks+1 end,
 calculate_cooldown_ms=function() callbacks=callbacks+1; return 0 end}
effects.set_definition('live',definition); effects.set_definition('alias',definition)
local effect<const> = effects.new(owner)
effect.id='effects'; registry:register(effect); registry:index(effect,effects)
effect:grant_effect('live')
function unbuild() tree.blackboard=blackboard.new() end
function drop()
 registry:deregister(machine); registry:deregister(tree); registry:deregister(bare)
 effect:revoke_effect('live'); registry:deregister(effect)
 machines.set_definition('live',nil); machines.set_definition('unused',nil)
 effects.set_definition('live',nil); effects.set_definition('alias',nil)
end
return true`;

for (const optLevel of [3] as const) test(`behavior32 O${optLevel}: real cartlib indexes, definitions, blackboard and effects remain read-only`, t => {
	const { images, cartSources } = compileCartlibProgram(ENTRY, { optLevel, modules: [{ path: 'cartlib/actioneffects/actioneffect_component', source: readFileSync('cartlib/actioneffects/actioneffect_component.lua', 'utf8') }] });
	const { cpu, runtime, sources } = eventHistoryRuntime(images);
	// Publish the exact compiler inputs rather than infer source correspondence from guest data.
	const compilerSources = new Map(Array.from(cartSources, ([path, source]) => [path, { displayPath: `${path}.lua`, source }]));
	compilerSources.set('entry', { displayPath: 'entry.lua', source: ENTRY });
	sources.currentBlua32Media = { ...sources.currentBlua32Media, cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols,
		compiledBlua32Sources(compilerSources), TEST_CARTRIDGE_CONTEXT_IDS[0]), null] };
	afterTest(t, () => sources.catalog.dispose());
	const guest = new SuspendedGuestSession(runtime);
	assert.equal(readStateMachineInstances(sources, guest, 0).available, false);
	assert.equal(readBehaviorDefinitions(sources, guest, 0, 'cartlib/actioneffects/actioneffect_component').available, false);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const before = [cpu.luaHeap.usedBytes(), runtime.machine.scheduler.currentNowCycles(), cpu.instructionBudgetRemaining];
	assert.equal(readStateMachineInstances(sources, guest, 1).available, false);
	assert.equal(readBehaviorDefinitions(sources, guest, 1, 'cartlib/actioneffects/actioneffect_component').available, false);
	const instances = readStateMachineInstances(sources, guest, 0);
	assert.equal(instances.available, true); assert.equal(instances.items.length, 1);
	const choice = instances.items[0], componentId = guest.identityScalar(choice.component, ValueTag.Table);
	const machineId = guest.identityScalar(choice.machine, ValueTag.Table);
	const states = readStateMachineStates(guest, choice.machine);
	assert.equal(states.length, 3);
	const leaves = states.filter(state => isNil(guest.readStringMember(state.state, 'current_id')));
	assert.equal(leaves.length, 2);
	assert.ok(leaves.every(state => state.description === ''), 'leaf current-child Nil must not be displayed as an encoded payload');
	for (const state of states) {
		const resolved = findStateMachineState(sources, guest, 0, componentId, machineId, guest.identityScalar(state.state, ValueTag.Table))!;
		assert.equal(resolved.state, state.state);
		const properties = inspectStateMachineState(sources, guest, resolved.machine, resolved.state);
		assert.equal(properties.find(item => item.identity?.section === 'component' && item.identity.field === '_started')!.value, 'false');
	}
	const definitions = readBehaviorDefinitions(sources, guest, 0, 'cartlib/fsm/fsm_component');
	assert.equal(definitions.available, true);
	assert.deepEqual(definitions.items.map(item => item.label).sort(), ['live', 'unused']);
	assert.equal(readStateMachineDefinitionStates(guest, definitions.items.find(item => item.label === 'live')!.definition).length, 3);
	assert.equal(readStateMachineDefinitionStates(guest, definitions.items.find(item => item.label === 'unused')!.definition).length, 1);

	const treeInstances = readBehaviorTreeInstances(sources, guest, 0);
	assert.equal(treeInstances.available, true); assert.equal(treeInstances.items.length, 2);
	const withBoard = treeInstances.items.find(item => item.label === 'board')!;
	const boardProperties = inspectBehaviorTreeInstance(sources, guest, withBoard.component);
	const slots = boardProperties.filter(item => item.identity?.section === 'blackboard' || item.identity?.section === 'blackboard-slot');
	assert.equal(slots.length, 6);
	const shadowed = slots.find(item => item.identity!.section === 'blackboard-slot')!;
	assert.equal(shadowed.identity!.key!.tag, ValueTag.Integer); assert.equal(shadowed.identity!.key!.scalar, 1);
	assert.equal(shadowed.watchIdentity, undefined);
	const namedAnswer = slots.find(item => item.identity!.key!.scalar === 'answer');
	assert.ok(namedAnswer, 'the final declaration must own the named blackboard watch');
	assert.equal(namedAnswer.value, '0.25');
	assert.equal(slots.find(item => item.identity!.key!.scalar === 'big')!.value, '16777217');
	assert.equal(slots.find(item => item.identity!.key!.scalar === 'unset')!.value, 'nil');
	const numericKey = slots.find(item => item.identity!.section === 'blackboard' && item.identity!.key!.tag === ValueTag.Integer && item.identity!.key!.scalar === 1);
	assert.equal(numericKey?.value, '4', 'Integer 1 and Float 1.0 name the same table-indexed blackboard key');
	assert.equal(slots.filter(item => item.identity!.section === 'blackboard-slot').length, 2);
	const bare = treeInstances.items.find(item => item.label === 'bare')!;
	assert.equal(inspectBehaviorTreeInstance(sources, guest, bare.component).find(item => item.identity?.field === 'blackboard')!.value, 'nil');

	const granted = readActionEffectInstances(sources, guest, 0);
	assert.equal(granted.available, true); assert.equal(granted.items.length, 1);
	const effectChoice = granted.items[0], effectComponentId = guest.identityScalar(effectChoice.component, ValueTag.Table);
	const effectId = guest.identityScalar(effectChoice.effect, ValueTag.Table);
	assert.equal(findActionEffectInstance(sources, guest, 0, effectComponentId, effectId)!.effect, effectChoice.effect);
	const properties = inspectActionEffectInstance(sources, guest, effectChoice);
	assert.equal(properties.find(item => item.identity?.section === 'instance' && item.identity.field === 'active_count')!.value, '0');
	assert.equal(properties.find(item => item.identity?.section === 'instance' && item.identity.field === 'cooldown_until_ms')!.value, '0');
	assert.equal(properties.some(item => item.identity?.section === 'instance' && item.identity.field === 'next_execution_ms'), false);
	const catalog = readBehaviorDefinitions(sources, guest, 0, 'cartlib/actioneffects/actioneffect_component');
	assert.equal(catalog.available, true);
	assert.deepEqual(catalog.items.map(item => item.label).sort(), ['alias', 'live']);
	assert.equal(catalog.items[0].definition, catalog.items[1].definition, 'published aliases remain two entries for one actual definition');
	assert.ok(properties.some(item => item.source?.resource.path === 'entry.lua'), 'actual retained callback resolves to its compiler source');
	assert.equal(asInteger(guest.global('callbacks')), 0);
	assert.deepEqual([cpu.luaHeap.usedBytes(), runtime.machine.scheduler.currentNowCycles(), cpu.instructionBudgetRemaining], before,
		'inspection neither allocates guest storage nor executes the guest');

	guest.invalidate();
	runCompletionClosure(cpu, asClosure(guest.global('unbuild'), cpu.gc), []);
	const rebound = readBehaviorTreeInstances(sources, guest, 0).items.find(item => item.label === 'board')!;
	const unbound = inspectBehaviorTreeInstance(sources, guest, rebound.component);
	for (const field of ['_layout', '_values'])
		assert.equal(unbound.find(item => item.identity?.section === 'blackboard' && item.identity.field === field)!.value, 'nil',
			'an actual unbound blackboard exposes its stored Nil values, not invented named slots');
	guest.invalidate();
	runCompletionClosure(cpu, asClosure(guest.global('drop'), cpu.gc), []);
	assert.equal(readStateMachineInstances(sources, guest, 0).items.length, 0);
	assert.equal(findStateMachineState(sources, guest, 0, componentId, machineId, machineId), undefined);
	assert.equal(readBehaviorTreeInstances(sources, guest, 0).items.length, 0);
	assert.equal(findActionEffectInstance(sources, guest, 0, effectComponentId, effectId), undefined);
	for (const module of ['cartlib/fsm/fsm_component', 'cartlib/actioneffects/actioneffect_component']) {
		const empty = readBehaviorDefinitions(sources, guest, 0, module);
		assert.equal(empty.available, true); assert.equal(empty.items.length, 0);
	}
	assert.equal(isNil(guest.global('callbacks')), false);
	assert.equal(asInteger(guest.global('callbacks')), 0);
});
