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
	['testlib/actioneffects/trigger_recorder', 'testlib/actioneffects/trigger_recorder.lua'],
] as const;

const TRACE_ENTRY_SOURCE = `
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local trigger_recorder<const> = require('testlib/actioneffects/trigger_recorder')

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
		owner.actioneffects:trigger('inner')
	end,
})
actioneffect_component.set_definition('plain', {})

local component<const> = actioneffect_component.new({ parent = owner })
owner.actioneffects = component
local recorder<const> = trigger_recorder.new(component, 8)
local effect_ids<const> = {
	'on_cooldown',
	'required_tag',
	'blocked_tag',
	'required_state',
	'blocked_state',
	'custom',
	'inner',
	'outer',
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

local run_plain<const> = function(count)
	for _ = 1, count do
		component:trigger('plain')
	end
end

local dispose<const> = function()
	recorder:dispose()
end

return run_plain,
	dispose,
	recorder,
	results,
	owner.tag_checks,
	owner.state_checks,
	custom_gate_calls,
	cooldown_calculations,
	owner.inner_runs
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

test('ActionEffect trace publishes direct outcomes for effects granted after recorder binding', () => {
	const { cpu } = createActionEffectCpu('emit');
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const [runPlain, dispose, channel, results, tagChecks, stateChecks,
		customGateCalls, cooldownCalculations, innerRuns] =
		materializeCpuCompletionValues(cpu) as [
			Closure,
			Closure,
			Table,
			Table,
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
	], [false, false, false, false, false, false, true]);
	assert.deepEqual(
		[tagChecks, stateChecks, customGateCalls, cooldownCalculations, innerRuns],
		[2, 2, 1, 1, 1],
	);
	assert.equal(readString(channel, 1), 'trace_owner.1');
	assert.equal(readString(channel, 2), 'trace_owner');
	assert.equal(channel.getInteger(3), 8);
	assert.equal(channel.getInteger(4), 8);
	const records = channel.getInteger(5) as Table;
	const expected = [
		['on_cooldown', 'cooldown'],
		['required_tag', 'required_tag_missing'],
		['blocked_tag', 'blocked_tag_present'],
		['required_state', 'required_state_missing'],
		['blocked_state', 'blocked_state_present'],
		['custom', 'custom_gate'],
		['outer', 'accepted'],
		['inner', 'accepted'],
	] as const;
	for (let index = 0; index < expected.length; index += 1) {
		const record = records.getInteger(index + 1) as Table;
		assert.equal(record.getInteger(1), index + 1);
		assert.equal(readString(record, 3), expected[index][0]);
		assert.equal(readString(record, 4), expected[index][1]);
	}

	runCompletionClosure(cpu, runPlain, 20);
	const heapBefore = cpu.collectTrackedHeapBytes();
	const recordedCycles = runCompletionClosure(cpu, runPlain, 10_000);
	assert.equal(cpu.collectTrackedHeapBytes(), heapBefore);
	assert.equal(channel.getInteger(4), 10_028);
	for (let sequence = 10_021; sequence <= 10_028; sequence += 1) {
		const slot = ((sequence - 1) % 8) + 1;
		const record = records.getInteger(slot) as Table;
		assert.equal(record.getInteger(1), sequence);
		assert.equal(readString(record, 4), 'accepted');
	}

	cpu.beginCompletionCall(dispose, []);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	const unselectedCycles = runCompletionClosure(cpu, runPlain, 10_000);
	assert.ok(unselectedCycles <= 970_000, `unselected trace used ${unselectedCycles} cycles`);
	const recorderCycles = recordedCycles - unselectedCycles;
	assert.ok(recorderCycles > 0);
	assert.ok(recorderCycles <= 350_000, `recorder used ${recorderCycles} cycles`);
});

test('ordinary ActionEffect bytecode contains no trace channel or outcome labels', () => {
	const { cpu, cart } = createActionEffectCpu('erase');
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const [runPlain] = materializeCpuCompletionValues(cpu) as [Closure];
	const erasedCycles = runCompletionClosure(cpu, runPlain, 10_000);
	assert.ok(erasedCycles <= 950_000, `ordinary trigger used ${erasedCycles} cycles`);
	const traceStrings = [
		'actioneffect.trigger',
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
