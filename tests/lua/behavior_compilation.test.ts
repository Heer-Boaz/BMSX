import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { BT_COMPILATION_PROBE_SOURCE } from '../helpers/behavior_compilation_fixture';
import { runCompletionClosure } from './cpu_test_harness';

const recorderModule = {
	path: 'testlib/behaviour_tree/compile_recorder',
	source: readFileSync('testlib/behaviour_tree/compile_recorder.lua', 'utf8'),
};

const observationChannels = new Set(['bt.compile.begin', 'bt.compile.node', 'bt.compile.end', 'bt.bind.complete']);

for (const optLevel of [0, 3] as const) test(`BT compilation observes occurrences, not evaluator or actor identity (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(BT_COMPILATION_PROBE_SOURCE + `
probe.observe()
probe.compile(2, true)
probe.check_unobserved()
probe.check()
probe.mutate()
probe.check()
probe.run(32)
probe.check()
probe.drop_definition()
`, { optLevel, traceStatements: observationChannels, modules: [recorderModule] });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	cpu.collectTrackedHeapBytes();
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const weak = probe.getStringKey(cpu.stringPool.find('weak_inputs')!) as Table;
	assert.equal(weak.getInteger(1), null, 'capture does not retain the mutable declaration');
	assert.equal(weak.getInteger(2), null, 'declaration identity map dies with the compilation layout');
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check_replaced')!) as Closure, []);
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check')!) as Closure, []);
	cpu.collectTrackedHeapBytes();
	const displaced = probe.getStringKey(cpu.stringPool.find('displaced')!) as Table;
	for (let index = 1; index <= 3; index += 1) assert.equal(displaced.getInteger(index), null);
	const retained = cpu.collectTrackedHeapBytes();
	for (let replacement = 0; replacement < 32; replacement += 1) {
		runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('check_replaced')!) as Closure, []);
		assert.equal(cpu.collectTrackedHeapBytes(), retained, 're-registration must not grow retained observation history');
	}
	const anchor = cpu.captureRuntimeState();
	const strings = cpu.stringPool.captureState();
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('run')!) as Closure, [32]);
	const expected = cpu.captureRuntimeState();
	for (let replay = 0; replay < 2; replay += 1) {
		cpu.stringPool.restoreState(strings);
		cpu.restoreRuntimeState(anchor);
		const restored = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		assert.notEqual(restored, probe);
		runCompletionClosure(cpu, restored.getStringKey(cpu.stringPool.find('run')!) as Closure, [32]);
		assert.deepEqual(cpu.captureRuntimeState(), expected);
		runCompletionClosure(cpu, restored.getStringKey(cpu.stringPool.find('check')!) as Closure, []);
	}
});

test('compilation identity survives equal callbacks, and failure publishes no completed capture', () => {
	const { cpu } = createCartlibProgramHarness(`
local compiler<const> = require('cartlib/behaviour_tree/program')
local recorder<const> = require('testlib/behaviour_tree/compile_recorder').new()
local result<const> = require('cartlib/behaviour_tree/result')
local callback<const> = function() return result.success end
local shared<const> = { type = 'task', task = { execute = callback } }
local first<const> = compiler.compile('same', { root = { type = 'sequence', children = { shared } } })
local first_capture<const> = recorder.programs[first]
local second<const> = compiler.compile('same', { root = { type = 'selector', children = { shared } } })
local second_capture<const> = recorder.programs[second]
assert(first ~= second and first_capture ~= second_capture)
assert(first.evaluate == callback and second.evaluate == callback)
assert(first.operand == second.operand and first.reset == second.reset)
assert(first_capture.nodes[1].type == 'sequence' and second_capture.nodes[1].type == 'selector')
assert(first_capture.nodes[1].evaluate == first_capture.nodes[2].evaluate)
local accepted<const> = pcall(compiler.compile, 'failed', { root = { type = 'no_such_node' } })
assert(not accepted and recorder.programs[first] == first_capture and recorder.programs[second] == second_capture)
recorder:dispose()
local unobserved<const> = compiler.compile('unobserved', { root = shared })
assert(recorder.programs[unobserved] == nil)
`, { traceStatements: 'emit', modules: [recorderModule] });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
});

test('BT observation retains the effective node kind from the supported table-prototype lookup', () => {
	for (const tracing of [false, true]) {
		const { cpu } = createCartlibProgramHarness(`
local compiler<const> = require('cartlib/behaviour_tree/program')
local recorder<const> = require('testlib/behaviour_tree/compile_recorder').new()
local result<const> = require('cartlib/behaviour_tree/result')
local calls = 0
local prototype<const> = { type = 'task', task = { execute = function() calls = calls + 1; return result.success end } }
local node<const> = setmetatable({}, { __index = prototype })
local compiled<const> = compiler.compile('computed', { root = node })
prototype.type = 'wait'
assert(calls == 0)
${tracing ? "assert(recorder.programs[compiled].nodes[1].type == 'task')" : ''}
`, { traceStatements: tracing ? 'emit' : 'erase', modules: [recorderModule] });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	}
});

for (const optLevel of [0, 3] as const) test(`BT records follow program/actor reachability, including ephemeron cycles (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
local compiler<const> = require('cartlib/behaviour_tree/program')
local component<const> = require('cartlib/behaviour_tree/bt_component')
local recorder<const> = require('testlib/behaviour_tree/compile_recorder').new()
local result<const> = require('cartlib/behaviour_tree/result')
local weak_values<const> = { __mode = 'v' }
local task<const> = { type = 'task', task = { execute = function() return result.success end } }
local definition<const> = { root = task }
probe = { recorder = recorder }

local first<const> = compiler.compile('shared', definition)
component.install_program(first)
probe.first = component.new({ parent = {} }, 'shared')
probe.old = setmetatable({ first, recorder.programs[first], probe.first }, weak_values)
local second<const> = compiler.compile('shared', definition)
component.install_program(second)
probe.second = component.new({ parent = {} }, 'shared')
assert(first ~= second and first.evaluate == second.evaluate and first.reset == second.reset)
assert(recorder.completed_bindings[probe.first] == first)
assert(recorder.completed_bindings[probe.second] == second)
assert(recorder.programs[first] ~= recorder.programs[second])

local unused<const> = compiler.compile('unused', definition)
component.install_program(unused)
probe.unused = setmetatable({ unused, recorder.programs[unused] }, weak_values)

local make_cycle<const> = function()
	component.install_program(compiler.compile('cyclic', definition))
	local actor<const> = component.new({ parent = {} }, 'cyclic')
	local cyclic<const> = compiler.compile('cyclic', { root = { type = 'task', task = {
		execute = function() return actor.enabled and result.success or result.failure end,
	} } })
	component.install_program(cyclic)
	actor:rebind_program(cyclic)
	local refs<const> = setmetatable({ actor, cyclic, recorder.programs[cyclic] }, weak_values)
	component.install_program(compiler.compile('cyclic', definition))
	return refs
end
probe.cycle = make_cycle()

-- A successfully compiled but never installed/bound program is not a root.
local abandoned<const> = compiler.compile('abandoned', definition)
probe.abandoned = setmetatable({ abandoned, recorder.programs[abandoned] }, weak_values)
function probe.drop_first() probe.first = nil end
`, { optLevel, traceStatements: observationChannels, modules: [recorderModule] });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	cpu.collectTrackedHeapBytes();
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	for (const name of ['old', 'unused']) {
		const references = probe.getStringKey(cpu.stringPool.find(name)!) as Table;
		assert.notEqual(references.getInteger(1), null, name);
		assert.notEqual(references.getInteger(2), null, name);
	}
	for (const [name, count] of [['cycle', 3], ['abandoned', 2]] as const) {
		const references = probe.getStringKey(cpu.stringPool.find(name)!) as Table;
		for (let index = 1; index <= count; index += 1) assert.equal(references.getInteger(index), null, name);
	}
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('drop_first')!) as Closure, []);
	cpu.collectTrackedHeapBytes();
	const old = probe.getStringKey(cpu.stringPool.find('old')!) as Table;
	for (let index = 1; index <= 3; index += 1) assert.equal(old.getInteger(index), null);
});

test('BT completion records distinguish nested, failed and detached rebinds from current field state', () => {
	const { cpu } = createCartlibProgramHarness(`
local compiler<const> = require('cartlib/behaviour_tree/program')
local component<const> = require('cartlib/behaviour_tree/bt_component')
local recorder<const> = require('testlib/behaviour_tree/compile_recorder').new()
local result<const> = require('cartlib/behaviour_tree/result')
local inner<const> = compiler.compile('same', { root = { type = 'wait', duration_ticks = 2 } })
local outer<const> = compiler.compile('same', { root = { type = 'wait', duration_ticks = 3 } })
local initial
local fail = false
local saw_nested = false
initial = compiler.compile('same', { root = { type = 'task', task = {
	execute = function() return result.running end,
	tick = function() return result.running end,
	abort = function(_, execution)
		assert(recorder.completed_bindings[execution] == initial)
		if fail then error('authored abort failed') end
		execution:rebind_program(inner)
		assert(recorder.completed_bindings[execution] == inner)
		saw_nested = true
	end,
} } })
component.install_program(initial)
local actor<const> = component.new({ parent = {} }, 'same')
actor.evaluate(actor.parent, actor, actor.operand)
actor:rebind_program(outer)
assert(saw_nested and recorder.completed_bindings[actor] == outer)

actor:rebind_program(initial)
actor.evaluate(actor.parent, actor, actor.operand)
fail = true
local accepted<const> = pcall(component.rebind_program, actor, outer)
assert(not accepted and recorder.completed_bindings[actor] == initial)
-- A completed fact is not an active-operation marker or a rollback. The
-- failed abort already cleared the activity slot in actual execution memory.
assert(actor._execution_state[1] == nil)
actor:rebind_program(outer)
assert(recorder.completed_bindings[actor] == outer)

recorder:dispose()
actor:rebind_program(inner)
assert(actor.evaluate == inner.evaluate and actor.operand == inner.operand)
assert(recorder.completed_bindings[actor] == outer)
`, { traceStatements: observationChannels, modules: [recorderModule] });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
});

test('BT capture costs are cold; retained aliases are not a compiled definition snapshot', t => {
	const measurements: { mode: string; code: number; setup: number; allocation: number; retained: number; compileCycles: number; tickCycles: number }[] = [];
	for (const mode of ['erased', 'retained', 'unselected', 'captured', 'cold-only'] as const) {
		const { cpu, images } = createCartlibProgramHarness(BT_COMPILATION_PROBE_SOURCE, {
			traceStatements: mode === 'cold-only' ? observationChannels
				: mode === 'erased' || mode === 'retained' ? 'erase' : 'emit',
			modules: [recorderModule],
		});
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const ready = cpu.collectTrackedHeapBytes();
		if (mode === 'captured' || mode === 'cold-only') {
			runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('observe')!) as Closure, []);
		}
		const before = cpu.collectTrackedHeapBytes();
		const compileCycles = runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('compile')!) as Closure, [32, mode === 'retained']);
		const allocation = cpu.luaHeap.usedBytes() - before;
		const retained = cpu.collectTrackedHeapBytes() - before;
		const weak = probe.getStringKey(cpu.stringPool.find('weak_inputs')!) as Table;
		assert.equal(weak.getInteger(1) === null, mode !== 'retained');
		const run = probe.getStringKey(cpu.stringPool.find('run')!) as Closure;
		runCompletionClosure(cpu, run, [384]);
		const warmBytes = cpu.luaHeap.usedBytes();
		const tickCycles = runCompletionClosure(cpu, run, [9984]);
		assert.equal(cpu.luaHeap.usedBytes(), warmBytes, `${mode}: evaluator must not allocate per tick`);
		measurements.push({ mode, code: images.cartImage.textBytes.byteLength, setup: before - ready, allocation, retained, compileCycles, tickCycles });
	}
	for (const row of measurements) {
		assert.equal(row.tickCycles, measurements[0].tickCycles, `${row.mode}: tracing must not change the execution path`);
		t.diagnostic(JSON.stringify(row));
	}
	assert.ok(measurements[1].retained > measurements[0].retained);
	assert.ok(measurements[3].retained > measurements[0].retained);
	assert.ok(measurements[3].compileCycles > measurements[2].compileCycles);
	assert.ok(measurements[4].code < measurements[3].code, 'cold-only capture must erase unrelated runtime channels');
	assert.equal(measurements[4].compileCycles, measurements[3].compileCycles);
	assert.equal(measurements[4].retained, measurements[3].retained);
});
