import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { collectReferenceHeapBytes } from '../helpers/cpu_heap_reference';
import { TEST_CART_TRANSFER_SOURCE, bootManagedTestSystem, linkManagedTestSystem } from '../helpers/managed_system';
import { loadTestBiosUtilityModules } from '../helpers/heap_service_system';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { THREAD_STACK_SLOT_BYTES } from '../../machine/ts/machine/cpu/thread';

import { asStringId, valueBool, valueInteger, valuePayload } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { TraceStatementSelection } from '../../toolchain/ts/lua/compiler/trace_statement';
import { linkTestCartBlua32 } from '../helpers/blua32';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { cartridgeSlots } from '../helpers/cartridge';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';
import { ACTIONEFFECT_SOURCE } from '../helpers/actioneffect_source_fixture';
import { ACTIONEFFECT_PHASE_ENTRY } from '../helpers/actioneffect_phase_fixture';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

const SYSTEM_ENTRY_SOURCE = `
require('base')
${TEST_CART_TRANSFER_SOURCE}
`;

const CONSOLE_STUB_SOURCE = `
return {
	write = function() end,
	end_line = function() end,
}
`;

const EVENT_EMITTER_STUB_SOURCE = `
return {
	remove_subscriber = function() end,
}
`;

const CART_MODULE_FILES = [
	['cartlib/registry', 'cartlib/registry.lua'],
	['cartlib/util/dense_set', 'cartlib/util/dense_set.lua'],
	['cartlib/component/base_component', 'cartlib/component/base_component.lua'],
	['cartlib/clock', 'cartlib/clock.lua'],
	['cartlib/actioneffects/actioneffect_component', 'cartlib/actioneffects/actioneffect_component.lua'],
	['testlib/actioneffects/recorder', 'testlib/actioneffects/recorder.lua'],
] as const;

const TRACE_ENTRY_SOURCE = `
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local actioneffect_recorder<const> = require('testlib/actioneffects/recorder')

local owner<const> = {
	id = 'trace_owner.1',
	definition_id = 'trace_owner',
	tags = { blocked = true },
	states = { blocked = true },
	tag_checks = 0,
	state_checks = 0,
	inner_runs = 0,
	world = { gameplay_time_ms = 10 },
	events = { emit = function() end },
}
function owner:has_tag(tag)
	self.tag_checks = self.tag_checks + 1
	return self.tags[tag] == true
end
owner.state_machines = {}
function owner.state_machines:bind_state_path(path)
	return path
end
function owner.state_machines:matches_state(path)
	owner.state_checks = owner.state_checks + 1
	return owner.states[path] == true
end

local custom_gate_calls = 0
local cooldown_calculations = 0
actioneffect_component.set_definition('on_cooldown', { initial_cooldown_ms = 100 })
actioneffect_component.set_definition('required_tag', { required_tags = { 'required' } })
actioneffect_component.set_definition('blocked_tag', { blocked_tags = { 'blocked' } })
actioneffect_component.set_definition('required_state', { required_state_paths = { 'required' } })
actioneffect_component.set_definition('blocked_state', { blocked_state_paths = { 'blocked' } })
actioneffect_component.set_definition('custom', {
	can_trigger = function()
		custom_gate_calls = custom_gate_calls + 1
		return false
	end,
})
actioneffect_component.set_definition('inner', {
	handler = function()
		owner.inner_runs = owner.inner_runs + 1
	end,
})
actioneffect_component.set_definition('outer', {
	calculate_cooldown_ms = function()
		cooldown_calculations = cooldown_calculations + 1
		return 25
	end,
	handler = function()
		owner.actioneffects:activate('nested')
		owner.actioneffects:trigger('inner')
		owner.actioneffects:deactivate('nested')
	end,
})
actioneffect_component.set_definition('nested', {})
actioneffect_component.set_definition('plain', {})

local component<const> = actioneffect_component.new(owner)
owner.actioneffects = component
local recorder<const> = actioneffect_recorder.new(component, 16)
local effect_ids<const> = {
	'on_cooldown',
	'required_tag',
	'blocked_tag',
	'required_state',
	'blocked_state',
	'custom',
	'inner',
	'outer',
	'nested',
	'plain',
}
for i = 1, #effect_ids do
	component:grant_effect(effect_ids[i])
end
component:on_activate()

local results<const> = {
	component:trigger('on_cooldown'),
	component:trigger('required_tag'),
	component:trigger('blocked_tag'),
	component:trigger('required_state'),
	component:trigger('blocked_state'),
	component:trigger('custom'),
	component:trigger('outer'),
}

component:activate('plain')
component:activate('plain')
results[8] = component:trigger('plain')
component:deactivate('plain')
component:deactivate('plain')
local final_active_count<const> = component.effects.plain.active_count

-- The host invokes these again after collection; the cartridge owns the closures.
run_plain = function(count)
	for _ = 1, count do
		component:trigger('plain')
	end
end

run_activity = function(count)
	for _ = 1, count do
		component:activate('plain')
		component:deactivate('plain')
	end
end

dispose = function()
	recorder:dispose()
end

return recorder,
	results,
	owner.tag_checks,
	owner.state_checks,
	custom_gate_calls,
	cooldown_calculations,
	owner.inner_runs,
	final_active_count
`;

const ACTIVITY_COMMIT_ENTRY_SOURCE = `
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')

local owner<const> = {
	id = 'commit_owner.1',
	definition_id = 'commit_owner',
	world = { gameplay_time_ms = 100 },
	events = { emit = function() end },
}
owner.state_machines = {}
function owner.state_machines:bind_state_path(path)
	return path
end

actioneffect_component.set_definition('periodic', { period_ms = 25 })
local component<const> = actioneffect_component.new(owner)
owner.actioneffects = component
component:grant_effect('periodic')
component:on_activate()

local observations<const> = {}
local sink<const> = {}
function sink:record(kind, effect_id, value)
	local effect<const> = component.effects[effect_id]
	observations[#observations + 1] = {
		kind,
		effect_id,
		value,
		effect.active_count,
		effect.periodic_index,
		effect.next_execution_ms,
		component.periodic_effect_count,
	}
end
blua32.trace_sink(component, 'actioneffect.fact', sink)

component:activate('periodic')
component:activate('periodic')
component:deactivate('periodic')
component:deactivate('periodic')

return observations
`;

function sourceModule(path: string, source: string) {
	return {
		path,
		source,
		chunk: parseLuaChunk(source, `${path}.lua`),
	};
}

function createActionEffectCpu(
	traceStatements: TraceStatementSelection,
	entrySource = TRACE_ENTRY_SOURCE,
) {
	const systemModules = [...loadTestBiosUtilityModules(), ...BASE_FIRMWARE_MODULES, { path: 'tty/console', source: CONSOLE_STUB_SOURCE }];
	const cartModules = CART_MODULE_FILES.map(([path, file]) =>
		sourceModule(path, readFileSync(file, 'utf8')),
	);
	cartModules.push(sourceModule('cartlib/event_emitter', EVENT_EMITTER_STUB_SOURCE));
	const system = linkManagedTestSystem(SYSTEM_ENTRY_SOURCE, 3, systemModules, BIOS_FUNCTION_EXPORTS);
	const cart = compileLuaChunkToProgram(
		parseLuaChunk(entrySource, 'entry.lua'),
		cartModules,
		{
			entrySource,
			optLevel: 3,
			programDomain: 'cart',
			traceStatements,
		},
	);
	const { cartRomBytes } = linkTestCartBlua32(system.biosImports, cart);
	const { cpu } = bootManagedTestSystem(system, 'main', cartridgeSlots(cartRomBytes));
	return { cpu, cart };
}

test('ActionEffect fact stream preserves trigger and activity commits in producer order', () => {
	const { cpu } = createActionEffectCpu('emit');
	runGuestToHalt(cpu, 10_000_000);
	const runPlain = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('run_plain')!), nativeHeapReference(cpu).gc);
	const runActivity = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('run_activity')!), nativeHeapReference(cpu).gc);
	const [channelValue, resultsValue, tagChecks, stateChecks,
		customGateCalls, cooldownCalculations, innerRuns, finalActiveCount] = materializeCpuCompletionValues(cpu);
	const channel = valuePayload(channelValue), results = valuePayload(resultsValue);
	const strings = cpu.stringPool;
	const readString = (table: number, index: number): string =>
		strings.toString(asStringId(cpu.tables.getInteger(table, index)));

	assert.deepEqual([
		cpu.tables.getInteger(results, 1),
		cpu.tables.getInteger(results, 2),
		cpu.tables.getInteger(results, 3),
		cpu.tables.getInteger(results, 4),
		cpu.tables.getInteger(results, 5),
		cpu.tables.getInteger(results, 6),
		cpu.tables.getInteger(results, 7),
		cpu.tables.getInteger(results, 8),
	], [false, false, false, false, false, false, true, true].map(valueBool));
	assert.deepEqual(
		[tagChecks, stateChecks, customGateCalls, cooldownCalculations, innerRuns],
		[2, 2, 1, 1, 1].map(valueInteger),
	);
	assert.equal(finalActiveCount, valueInteger(0));
	assert.equal(readString(channel, 1), 'trace_owner.1');
	assert.equal(readString(channel, 2), 'trace_owner');
	assert.equal(cpu.tables.getInteger(channel, 3), valueInteger(16));
	assert.equal(cpu.tables.getInteger(channel, 4), valueInteger(15));
	const records = valuePayload(cpu.tables.getInteger(channel, 5));
	const expectedTriggers = [
		['on_cooldown', 'cooldown'],
		['required_tag', 'required_tag_missing'],
		['blocked_tag', 'blocked_tag_present'],
		['required_state', 'required_state_missing'],
		['blocked_state', 'blocked_state_present'],
		['custom', 'custom_gate'],
		['outer', 'accepted'],
	] as const;
	for (let index = 0; index < expectedTriggers.length; index += 1) {
		const record = valuePayload(cpu.tables.getInteger(records, index + 1));
		assert.equal(cpu.tables.getInteger(record, 1), valueInteger(index + 1));
		assert.equal(readString(record, 3), 'trigger');
		assert.equal(readString(record, 4), expectedTriggers[index][0]);
		assert.equal(readString(record, 5), expectedTriggers[index][1]);
	}
	const nestedActivation = valuePayload(cpu.tables.getInteger(records, 8));
	assert.equal(readString(nestedActivation, 3), 'activate');
	assert.equal(readString(nestedActivation, 4), 'nested');
	assert.equal(cpu.tables.getInteger(nestedActivation, 5), valueInteger(1));
	const nestedTrigger = valuePayload(cpu.tables.getInteger(records, 9));
	assert.equal(readString(nestedTrigger, 3), 'trigger');
	assert.equal(readString(nestedTrigger, 4), 'inner');
	assert.equal(readString(nestedTrigger, 5), 'accepted');
	const nestedDeactivation = valuePayload(cpu.tables.getInteger(records, 10));
	assert.equal(readString(nestedDeactivation, 3), 'deactivate');
	assert.equal(readString(nestedDeactivation, 4), 'nested');
	assert.equal(cpu.tables.getInteger(nestedDeactivation, 5), valueInteger(0));
	const firstActivation = valuePayload(cpu.tables.getInteger(records, 11));
	assert.equal(readString(firstActivation, 3), 'activate');
	assert.equal(readString(firstActivation, 4), 'plain');
	assert.equal(cpu.tables.getInteger(firstActivation, 5), valueInteger(1));
	const secondActivation = valuePayload(cpu.tables.getInteger(records, 12));
	assert.equal(readString(secondActivation, 3), 'activate');
	assert.equal(readString(secondActivation, 4), 'plain');
	assert.equal(cpu.tables.getInteger(secondActivation, 5), valueInteger(2));
	const retainedTrigger = valuePayload(cpu.tables.getInteger(records, 13));
	assert.equal(readString(retainedTrigger, 3), 'trigger');
	assert.equal(readString(retainedTrigger, 4), 'plain');
	assert.equal(readString(retainedTrigger, 5), 'accepted');
	const firstDeactivation = valuePayload(cpu.tables.getInteger(records, 14));
	assert.equal(readString(firstDeactivation, 3), 'deactivate');
	assert.equal(readString(firstDeactivation, 4), 'plain');
	assert.equal(cpu.tables.getInteger(firstDeactivation, 5), valueInteger(1));
	const finalDeactivation = valuePayload(cpu.tables.getInteger(records, 15));
	assert.equal(readString(finalDeactivation, 3), 'deactivate');
	assert.equal(readString(finalDeactivation, 4), 'plain');
	assert.equal(cpu.tables.getInteger(finalDeactivation, 5), valueInteger(0));

	runCompletionClosure(cpu, runPlain, [valueInteger(20)]);
	// Collection can shrink the shared stack. Count recorder bytes, not stack capacity.
	const stack = cpu.activeThread.stackRegisters;
	const heapBefore = collectReferenceHeapBytes(cpu) - stack.capacity() * THREAD_STACK_SLOT_BYTES;
	const recordedCycles = runCompletionClosure(cpu, runPlain, [valueInteger(10_000)]);
	assert.equal(cpu.luaHeap.usedBytes() - stack.capacity() * THREAD_STACK_SLOT_BYTES, heapBefore);
	assert.equal(cpu.tables.getInteger(channel, 4), valueInteger(10_035));
	for (let sequence = 10_020; sequence <= 10_035; sequence += 1) {
		const slot = ((sequence - 1) % 16) + 1;
		const record = valuePayload(cpu.tables.getInteger(records, slot));
		assert.equal(cpu.tables.getInteger(record, 1), valueInteger(sequence));
		assert.equal(readString(record, 3), 'trigger');
		assert.equal(readString(record, 5), 'accepted');
	}

	runCompletionClosure(cpu, runActivity, [valueInteger(20)]);
	const activityHeapBefore = collectReferenceHeapBytes(cpu) - stack.capacity() * THREAD_STACK_SLOT_BYTES;
	const activityRecordedCycles = runCompletionClosure(cpu, runActivity, [valueInteger(10_000)]);
	assert.equal(cpu.luaHeap.usedBytes() - stack.capacity() * THREAD_STACK_SLOT_BYTES, activityHeapBefore);
	assert.equal(cpu.tables.getInteger(channel, 4), valueInteger(30_075));

	cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(strings.find('dispose')!), nativeHeapReference(cpu).gc), []);
	runGuestToHalt(cpu, 100_000);
	const unselectedCycles = runCompletionClosure(cpu, runPlain, [valueInteger(10_000)]);
	const unselectedActivityCycles = runCompletionClosure(cpu, runActivity, [valueInteger(10_000)]);
	// Same workload and opcode prices on the pre-migration core (aa1a4f285).
	assert.ok(unselectedCycles <= 7_470_024, `unselected trace used ${unselectedCycles} cycles`);
	const recorderCycles = recordedCycles - unselectedCycles;
	assert.ok(recorderCycles > 0);
	assert.ok(recorderCycles <= 2_000_000, `recorder used ${recorderCycles} cycles`);
	assert.ok(unselectedActivityCycles <= 4_020_024,
		`unselected activity trace used ${unselectedActivityCycles} cycles`);
	const activityRecorderCycles = activityRecordedCycles - unselectedActivityCycles;
	assert.ok(activityRecorderCycles > 0);
	assert.ok(activityRecorderCycles <= 3_960_000,
		`activity recorder used ${activityRecorderCycles} cycles`);
});

test('ActionEffect activity facts observe the committed count and periodic lane', () => {
	const { cpu: commitCpu } = createActionEffectCpu('emit', ACTIVITY_COMMIT_ENTRY_SOURCE);
	runGuestToHalt(commitCpu, 10_000_000);
	const [observationList] = materializeCpuCompletionValues(commitCpu);
	const observations = valuePayload(observationList);
	const strings = commitCpu.stringPool;
	const readString = (table: number, index: number): string =>
		strings.toString(asStringId(commitCpu.tables.getInteger(table, index)));
	const expected = [
		['activate', 1],
		['activate', 2],
		['deactivate', 1],
		['deactivate', 0],
	] as const;
	for (let index = 0; index < expected.length; index += 1) {
		const observation = valuePayload(commitCpu.tables.getInteger(observations, index + 1));
		assert.equal(readString(observation, 1), expected[index][0]);
		assert.equal(readString(observation, 2), 'periodic');
		assert.equal(commitCpu.tables.getInteger(observation, 3), valueInteger(expected[index][1]));
		assert.equal(commitCpu.tables.getInteger(observation, 4), valueInteger(expected[index][1]));
		assert.equal(commitCpu.tables.getInteger(observation, 5), valueInteger(1));
		assert.equal(commitCpu.tables.getInteger(observation, 6), valueInteger(125));
		assert.equal(commitCpu.tables.getInteger(observation, 7), valueInteger(1));
	}
});

test('source-visible ActionEffect fields obey real cartlib trigger, periodic, commit and rebind phases', () => {
	const modules = ['cartlib/actioneffects', 'cartlib/actioneffects/actioneffect_component']
		.map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') }));
	modules.push({ path: 'fixture/effects', source: ACTIONEFFECT_SOURCE });
	const { cpu } = createCartlibProgramHarness(ACTIONEFFECT_PHASE_ENTRY, { modules });
	runGuestToHalt(cpu, 10_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
});

test('ordinary ActionEffect bytecode contains no trace channel or outcome labels', () => {
	const { cpu, cart } = createActionEffectCpu('erase');
	runGuestToHalt(cpu, 10_000_000);

	const runPlain = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('run_plain')!), nativeHeapReference(cpu).gc);
	const runActivity = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('run_activity')!), nativeHeapReference(cpu).gc);
	const erasedCycles = runCompletionClosure(cpu, runPlain, [valueInteger(10_000)]);
	const erasedActivityCycles = runCompletionClosure(cpu, runActivity, [valueInteger(10_000)]);
	// Trace erasure must not make this workload dearer than the pre-migration core.
	assert.ok(erasedCycles <= 7_130_024, `ordinary trigger used ${erasedCycles} cycles`);
	assert.ok(erasedActivityCycles <= 3_340_024,
		`ordinary activity used ${erasedActivityCycles} cycles`);
	const traceStrings = [
		'actioneffect.fact',
		'cooldown',
		'required_tag_missing',
		'blocked_tag_present',
		'required_state_missing',
		'blocked_state_present',
		'custom_gate',
		'accepted',
	];
	for (let index = 0; index < traceStrings.length; index += 1) {
		assert.equal(
			cart.program.constPool.includes(traceStrings[index]),
			false,
			`ordinary constant pool contains '${traceStrings[index]}'`,
		);
	}
});
