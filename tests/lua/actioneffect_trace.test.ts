import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { Table } from '../../machine/ts/machine/cpu/table';
import {
	asStringId,
	type StringValue,
} from '../../machine/ts/machine/cpu/value';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { TraceStatementMode } from '../../toolchain/ts/lua/compiler/trace_statement';
import {
	createTestBlua32PairCpu,
	linkTestBlua32Pair,
} from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const SYSTEM_ENTRY_SOURCE = `
require('base')
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
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

const SYSTEM_MODULE_FILES = [
	['base', 'machine/bios/base.lua'],
] as const;

const CART_MODULE_FILES = [
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

local component<const> = actioneffect_component.new({ parent = owner })
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

local run_plain<const> = function(count)
	for _ = 1, count do
		component:trigger('plain')
	end
end

local run_activity<const> = function(count)
	for _ = 1, count do
		component:activate('plain')
		component:deactivate('plain')
	end
end

local dispose<const> = function()
	recorder:dispose()
end

return run_plain,
	run_activity,
	dispose,
	recorder,
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
local component<const> = actioneffect_component.new({ parent = owner })
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

function compileActionEffectProgram(
	traceStatements: TraceStatementMode,
	entrySource = TRACE_ENTRY_SOURCE,
) {
	const systemModules = SYSTEM_MODULE_FILES.map(([path, file]) =>
		sourceModule(path, readFileSync(file, 'utf8')),
	);
	systemModules.push(sourceModule('tty/console', CONSOLE_STUB_SOURCE));
	const cartModules = CART_MODULE_FILES.map(([path, file]) =>
		sourceModule(path, readFileSync(file, 'utf8')),
	);
	cartModules.push(sourceModule('cartlib/event_emitter', EVENT_EMITTER_STUB_SOURCE));
	const system = compileLuaChunkToProgram(
		parseLuaChunk(SYSTEM_ENTRY_SOURCE, 'boot.lua'),
		systemModules,
		{
			entrySource: SYSTEM_ENTRY_SOURCE,
			optLevel: 3,
			programDomain: 'system',
		},
	);
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
	return { system, cart };
}

function createActionEffectCpu(traceStatements: TraceStatementMode): {
	readonly cpu: CPU;
	readonly cart: ReturnType<typeof compileLuaChunkToProgram>;
} {
	const compiled = compileActionEffectProgram(traceStatements);
	const cpu = createTestBlua32PairCpu(linkTestBlua32Pair(
		compiled.system,
		compiled.cart,
	)).cpu;
	cpu.installBootPrimitives();
	return { cpu, cart: compiled.cart };
}

function runCompletionClosure(cpu: CPU, closure: Closure, count: number): number {
	const budget = 10_000_000;
	cpu.beginCompletionCall(closure, [count]);
	assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
	return budget - cpu.instructionBudgetRemaining;
}

test('ActionEffect fact stream preserves trigger and activity commits in producer order', () => {
	const { cpu } = createActionEffectCpu('emit');
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const [runPlain, runActivity, dispose, channel, results, tagChecks, stateChecks,
		customGateCalls, cooldownCalculations, innerRuns, finalActiveCount] =
		materializeCpuCompletionValues(cpu) as [
			Closure,
			Closure,
			Closure,
			Table,
			Table,
			number,
			number,
			number,
			number,
			number,
			number,
		];
	const strings = cpu.stringPool;
	const readString = (table: Table, index: number): string =>
		strings.toString(asStringId(table.getInteger(index) as StringValue));

	assert.deepEqual([
		results.getInteger(1),
		results.getInteger(2),
		results.getInteger(3),
		results.getInteger(4),
		results.getInteger(5),
		results.getInteger(6),
		results.getInteger(7),
		results.getInteger(8),
	], [false, false, false, false, false, false, true, true]);
	assert.deepEqual(
		[tagChecks, stateChecks, customGateCalls, cooldownCalculations, innerRuns],
		[2, 2, 1, 1, 1],
	);
	assert.equal(finalActiveCount, 0);
	assert.equal(readString(channel, 1), 'trace_owner.1');
	assert.equal(readString(channel, 2), 'trace_owner');
	assert.equal(channel.getInteger(3), 16);
	assert.equal(channel.getInteger(4), 15);
	const records = channel.getInteger(5) as Table;
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
		const record = records.getInteger(index + 1) as Table;
		assert.equal(record.getInteger(1), index + 1);
		assert.equal(readString(record, 3), 'trigger');
		assert.equal(readString(record, 4), expectedTriggers[index][0]);
		assert.equal(readString(record, 5), expectedTriggers[index][1]);
	}
	const nestedActivation = records.getInteger(8) as Table;
	assert.equal(readString(nestedActivation, 3), 'activate');
	assert.equal(readString(nestedActivation, 4), 'nested');
	assert.equal(nestedActivation.getInteger(5), 1);
	const nestedTrigger = records.getInteger(9) as Table;
	assert.equal(readString(nestedTrigger, 3), 'trigger');
	assert.equal(readString(nestedTrigger, 4), 'inner');
	assert.equal(readString(nestedTrigger, 5), 'accepted');
	const nestedDeactivation = records.getInteger(10) as Table;
	assert.equal(readString(nestedDeactivation, 3), 'deactivate');
	assert.equal(readString(nestedDeactivation, 4), 'nested');
	assert.equal(nestedDeactivation.getInteger(5), 0);
	const firstActivation = records.getInteger(11) as Table;
	assert.equal(readString(firstActivation, 3), 'activate');
	assert.equal(readString(firstActivation, 4), 'plain');
	assert.equal(firstActivation.getInteger(5), 1);
	const secondActivation = records.getInteger(12) as Table;
	assert.equal(readString(secondActivation, 3), 'activate');
	assert.equal(readString(secondActivation, 4), 'plain');
	assert.equal(secondActivation.getInteger(5), 2);
	const retainedTrigger = records.getInteger(13) as Table;
	assert.equal(readString(retainedTrigger, 3), 'trigger');
	assert.equal(readString(retainedTrigger, 4), 'plain');
	assert.equal(readString(retainedTrigger, 5), 'accepted');
	const firstDeactivation = records.getInteger(14) as Table;
	assert.equal(readString(firstDeactivation, 3), 'deactivate');
	assert.equal(readString(firstDeactivation, 4), 'plain');
	assert.equal(firstDeactivation.getInteger(5), 1);
	const finalDeactivation = records.getInteger(15) as Table;
	assert.equal(readString(finalDeactivation, 3), 'deactivate');
	assert.equal(readString(finalDeactivation, 4), 'plain');
	assert.equal(finalDeactivation.getInteger(5), 0);

	runCompletionClosure(cpu, runPlain, 20);
	const heapBefore = cpu.collectTrackedHeapBytes();
	const recordedCycles = runCompletionClosure(cpu, runPlain, 10_000);
	assert.equal(cpu.collectTrackedHeapBytes(), heapBefore);
	assert.equal(channel.getInteger(4), 10_035);
	for (let sequence = 10_020; sequence <= 10_035; sequence += 1) {
		const slot = ((sequence - 1) % 16) + 1;
		const record = records.getInteger(slot) as Table;
		assert.equal(record.getInteger(1), sequence);
		assert.equal(readString(record, 3), 'trigger');
		assert.equal(readString(record, 5), 'accepted');
	}

	runCompletionClosure(cpu, runActivity, 20);
	const activityHeapBefore = cpu.collectTrackedHeapBytes();
	const activityRecordedCycles = runCompletionClosure(cpu, runActivity, 10_000);
	assert.equal(cpu.collectTrackedHeapBytes(), activityHeapBefore);
	assert.equal(channel.getInteger(4), 30_075);

	cpu.beginCompletionCall(dispose, []);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	const unselectedCycles = runCompletionClosure(cpu, runPlain, 10_000);
	const unselectedActivityCycles = runCompletionClosure(cpu, runActivity, 10_000);
	assert.ok(unselectedCycles <= 960_000, `unselected trace used ${unselectedCycles} cycles`);
	const recorderCycles = recordedCycles - unselectedCycles;
	assert.ok(recorderCycles > 0);
	assert.ok(recorderCycles <= 360_000, `recorder used ${recorderCycles} cycles`);
	assert.ok(unselectedActivityCycles <= 450_000,
		`unselected activity trace used ${unselectedActivityCycles} cycles`);
	const activityRecorderCycles = activityRecordedCycles - unselectedActivityCycles;
	assert.ok(activityRecorderCycles > 0);
	assert.ok(activityRecorderCycles <= 700_000,
		`activity recorder used ${activityRecorderCycles} cycles`);
});

test('ActionEffect activity facts observe the committed count and periodic lane', () => {
	const committed = compileActionEffectProgram('emit', ACTIVITY_COMMIT_ENTRY_SOURCE);
	const commitCpu = createTestBlua32PairCpu(linkTestBlua32Pair(
		committed.system,
		committed.cart,
	)).cpu;
	commitCpu.installBootPrimitives();
	assert.equal(commitCpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const [observations] = materializeCpuCompletionValues(commitCpu) as [Table];
	const strings = commitCpu.stringPool;
	const readString = (table: Table, index: number): string =>
		strings.toString(asStringId(table.getInteger(index) as StringValue));
	const expected = [
		['activate', 1],
		['activate', 2],
		['deactivate', 1],
		['deactivate', 0],
	] as const;
	for (let index = 0; index < expected.length; index += 1) {
		const observation = observations.getInteger(index + 1) as Table;
		assert.equal(readString(observation, 1), expected[index][0]);
		assert.equal(readString(observation, 2), 'periodic');
		assert.equal(observation.getInteger(3), expected[index][1]);
		assert.equal(observation.getInteger(4), expected[index][1]);
		assert.equal(observation.getInteger(5), 1);
		assert.equal(observation.getInteger(6), 125);
		assert.equal(observation.getInteger(7), 1);
	}
});

test('ordinary ActionEffect bytecode contains no trace channel or outcome labels', () => {
	const { cpu, cart } = createActionEffectCpu('erase');
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const [runPlain, runActivity] = materializeCpuCompletionValues(cpu) as [Closure, Closure];
	const erasedCycles = runCompletionClosure(cpu, runPlain, 10_000);
	const erasedActivityCycles = runCompletionClosure(cpu, runActivity, 10_000);
	assert.ok(erasedCycles <= 950_000, `ordinary trigger used ${erasedCycles} cycles`);
	assert.ok(erasedActivityCycles <= 410_000,
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
