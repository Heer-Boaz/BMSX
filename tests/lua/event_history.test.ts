import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { compileEventHistoryFixture, eventHistoryRuntime } from '../helpers/event_history';
import { createRuntimeDebuggerState, resetRuntimeDebuggerExecution, RuntimeDebuggerResumeMode } from '../../ide/runtime/debugger_state';
import { RuntimeEventHistory } from '../../ide/runtime/event_history';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { EventViewerInput } from '../../ide/workbench/contrib/events/editor_input';
import { GuestValueSnapshot, VALUE_SNAPSHOT_ENTRIES, VALUE_SNAPSHOT_CHARACTERS, VALUE_SNAPSHOT_SLOTS } from '../../ide/runtime/value_snapshot';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk, materializeCpuCompletionValues } from './cpu_test_harness';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';

const BUDGET = 10_000_000;

for (const optLevel of [0, 3] as const) test(`source trace captures real nested/unhandled events before mutation without instruction hooks (O${optLevel})`, () => {
	const { images } = createCartlibProgramHarness(`
local events<const> = require('cartlib/event_emitter')
local port<const> = events.events_of({ id = 'player' })
local data<const> = { health = 9, position = { x = 4 }, label = 'before' }
data.self = data
events:on({ event = 'outer', subscriber = {}, handler = function(_, _, _, payload)
  port:emit('inner', false)
  payload.health = 1
end })
port:emit('outer', data)
port:emit('unhandled', nil)
return data.health`, { optLevel, hostTraceChannels: ['event.emit'] });
	const { cpu, runtime, sources } = eventHistoryRuntime(images);
	const events = new RuntimeEventHistory(runtime, sources);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.equal(events.count, 3);
	assert.deepEqual([0, 1, 2].map(index => events.at(index).event), ['outer', 'inner', 'unhandled'].map(value => ({ kind: 'string', value, omitted: false })));
	assert.deepEqual(events.at(0).emitter, { kind: 'string', value: 'player', omitted: false });
	assert.deepEqual(events.at(1).payload, { kind: 'boolean', value: false });
	assert.deepEqual(events.at(2).payload, { kind: 'nil' });
	const data = events.at(0).payload;
	assert.ok(data.kind === 'table');
	assert.deepEqual(data.entries.find(entry => entry.key.kind === 'string' && entry.key.value === 'health')!.value, { kind: 'number', value: 9 });
	assert.deepEqual(data.entries.find(entry => entry.key.kind === 'string' && entry.key.value === 'self')!.value, { kind: 'reference', id: data.id });
});

test('automatic history wraps and survives pane closure and debugger reconfiguration', () => {
	const { cpu, runtime, sources } = eventHistoryRuntime(compileEventHistoryFixture());
	const events = new RuntimeEventHistory(runtime, sources);
	cpu.runUntilDepth(0, BUDGET);
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	const pane = new EventViewerInput(events), projection = pane.projection;
	cpu.beginCompletionCall(fn, [1]); cpu.runUntilDepth(0, BUDGET);
	const first = events.at(0);
	projection.update(events, 'fixture');
	assert.equal(projection.rows.length, 1);
	pane.dispose();
	cpu.beginCompletionCall(fn, [events.capacity + 3]); cpu.runUntilDepth(0, BUDGET);
	assert.equal(events.count, events.capacity);
	assert.equal(events.expired, 4);
	assert.equal(events.firstSequence, 4);
	projection.update(events, 'fixture');
	assert.equal(projection.rows[0].sequence, 4);
	assert.equal(projection.rows.length, events.capacity);
	assert.ok(first.payload.kind === 'table');
	assert.deepEqual(first.payload.entries.find(entry => entry.key.kind === 'string' && entry.key.value === 'value')!.value, { kind: 'number', value: 1 });
	const end = events.endSequence;
	runtime.history.mode = HistoryMode.Replaying;
	cpu.beginCompletionCall(fn, [2]); cpu.runUntilDepth(0, BUDGET);
	assert.equal(events.endSequence, end, 'replay does not duplicate historical emissions');
	runtime.history.mode = HistoryMode.Disabled;
	const debuggerState = createRuntimeDebuggerState(runtime, sources);
	resetRuntimeDebuggerExecution(debuggerState);
	cpu.beginCompletionCall(fn, [1]); cpu.runUntilDepth(0, BUDGET);
	assert.equal(events.at(end).timeline, first.timeline, 'debugger creation/reset must neither replace the observer nor split its timeline');
	events.beginTimeline();
	cpu.beginCompletionCall(fn, [1]); cpu.runUntilDepth(0, BUDGET);
	assert.ok(events.at(end + 1).timeline > events.at(end).timeline);
	events.clear(); projection.update(events, 'fixture');
	assert.equal(projection.rows.length, 0);
	assert.equal(events.expired, 0);
	cpu.beginCompletionCall(fn, [1]); cpu.runUntilDepth(0, BUDGET);
	projection.update(events, 'fixture');
	assert.equal(projection.rows.length, 1);
});

test('a source breakpoint stops before trace execution and continuing emits exactly once', () => {
	const { cpu, sources, runtime } = eventHistoryRuntime(compileEventHistoryFixture());
	const events = new RuntimeEventHistory(runtime, sources);
	const state = createRuntimeDebuggerState(runtime, sources);
	cpu.runUntilDepth(0, BUDGET);
	const image = sources.currentBlua32Media.cartridgeSlots[0]!;
	const fnIndex = image.symbols!.metadata.functionDisplayNames.indexOf('event_emitter.emit');
	const pc = image.layout.functions[fnIndex].codeAddress;
	state.source.install(sources.currentBlua32Media, [new Map(), new Map([[pc, 0]]), new Map()]);
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	cpu.beginCompletionCall(fn, [1]);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.ExecutionStopped);
	assert.equal(events.count, 0);
	state.source.resume(RuntimeDebuggerResumeMode.Continue);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.equal(events.count, 1);
});

test('native trace route evaluates once and supersedes the selected guest sink for its channel', () => {
	const source = `local subject = {}
local count = 0
local function value() count = count + 1; return count end
blua32.trace_sink(subject, 'sample', { record = function() count = 100 end })
blua32.trace(subject, 'sample', value())
return count`;
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'host_trace.lua'), [], {
		programDomain: 'system', entrySource: source, traceStatements: 'emit', hostTraceChannels: ['sample'],
	});
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1]);
});

for (const optLevel of [0, 3] as const) test(`host trace arguments retain captured lexical bindings (O${optLevel})`, () => {
	const source = `local subject = {}
local value = 1
local function emit()
  blua32.trace(subject, 'sample', value)
  value = value + 1
end
emit()
emit()
return value`;
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'host_trace_closure.lua'), [], {
		programDomain: 'system', entrySource: source, optLevel, hostTraceChannels: ['sample'],
	});
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
	cpu.installBootPrimitives();
	const values: number[] = [];
	cpu.setTraceHook((_domain, args) => values.push(args.registers.getScalar(args.base + 2)));
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.deepEqual(values, [1, 2]);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [3]);
});

test('snapshot budgets mark omission without invoking guest metatables', () => {
	const { cpu } = createCartlibProgramHarness(`local e<const> = require('cartlib/event_emitter')
local payload<const> = setmetatable({}, { __index = function() error('must not execute') end })
for i=1,100 do payload[i] = string.rep('x', 5000) end
e:emit('large', nil, payload, 'fixture')`, { hostTraceChannels: ['event.emit'] });
	const snapshots = new GuestValueSnapshot(cpu.stringPool);
	let snapshot: ReturnType<GuestValueSnapshot['read']>;
	cpu.setTraceHook((_domain, args) => { snapshots.begin(); snapshot = snapshots.read(args.registers, args.base + 4); });
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.ok(snapshot!.kind === 'table');
	assert.equal(snapshot.entries.length, VALUE_SNAPSHOT_ENTRIES);
	assert.equal(snapshot.omitted, true);
	const value = snapshot.entries[0].value;
	assert.ok(value.kind === 'string');
	assert.equal(value.value.length, VALUE_SNAPSHOT_CHARACTERS);
	assert.equal(value.omitted, true);
});

test('observer adds no guest work; selected source instrumentation cost is measured separately', t => {
	const enabled = compileEventHistoryFixture(), erased = compileEventHistoryFixture([]);
	const variants = [eventHistoryRuntime(erased), eventHistoryRuntime(enabled), eventHistoryRuntime(enabled)]
		.map(f => ({ ...f, events: new RuntimeEventHistory(f.runtime, f.sources) }));
	variants[1].cpu.setTraceHook(null);
	const elapsed: number[][] = [[], [], []], costs: number[] = [], heapBytes: number[] = [];
	const functions = variants.map(({cpu}) => {
		cpu.runUntilDepth(0, BUDGET);
		return cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	});
	for (let repeat = 0; repeat < 11; repeat++) for (let offset = 0; offset < variants.length; offset++) {
		const index = (repeat + offset) % variants.length;
		const { cpu, runtime, events } = variants[index];
		events.clear();
		cpu.beginCompletionCall(functions[index], [1000]);
		const start = performance.now();
		assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
		elapsed[index].push(performance.now() - start);
		costs[index] = BUDGET - cpu.instructionBudgetRemaining;
		heapBytes[index] = cpu.luaHeap.usedBytes();
		assert.equal(events.count, index === 2 ? 1000 : 0);
	}
	assert.equal(costs[1], costs[2]);
	assert.equal(heapBytes[1], heapBytes[2]);
	assert.ok(costs[1] > costs[0], 'source instrumentation has an honest, nonzero guest cost');
	const medians = elapsed.map(samples => samples.slice(4).sort((a, b) => a - b)[3]);
	t.diagnostic(JSON.stringify({ variants: ['erased', 'trace-unobserved', 'history'], cycles: costs, heapBytes, medianMs: medians }));
});

test('numeric snapshots preserve full precision and IEEE special values across JSON', () => {
	const { cpu } = eventHistoryRuntime(compileEventHistoryFixture());
	const snapshot = new GuestValueSnapshot(cpu.stringPool), slots = new ValueSlots(7);
	const values = [1234567, 0.123456789012345, -0, Infinity, -Infinity, NaN, 0];
	values.forEach((value, index) => slots.setNumber(index, value));
	snapshot.begin();
	const captured = values.map((_value, index) => snapshot.read(slots, index));
	assert.deepEqual(captured, [1234567, 0.123456789012345, '-0', 'inf', '-inf', 'nan', 0]
		.map(value => ({ kind: 'number', value })));
	slots.clear(values.length);
	assert.deepEqual(JSON.parse(JSON.stringify(captured)), captured);
});

test('snapshot work includes vacant storage and shares its scan budget across nested values', () => {
	const { cpu } = eventHistoryRuntime(compileEventHistoryFixture());
	const reader = new GuestValueSnapshot(cpu.stringPool), values = new ValueSlots(1);
	const child = cpu.createTable(VALUE_SNAPSHOT_SLOTS, 0), root = cpu.createTable(2, 0);
	child.set(VALUE_SNAPSHOT_SLOTS, 17);
	root.set(1, child); root.set(2, 42);
	values.set(0, root);
	reader.begin();
	const result = reader.read(values, 0);
	assert.ok(result.kind === 'table');
	assert.equal(result.omitted, true);
	assert.equal(result.entries.length, 1);
	const nested = result.entries[0].value;
	assert.ok(nested.kind === 'table');
	assert.equal(nested.entries.length, 0);
	assert.equal(nested.omitted, true);
	// This is one emission-wide budget, not a fresh allowance per argument.
	values.set(0, cpu.createTable(1, 0));
	const exhausted = reader.read(values, 0);
	assert.ok(exhausted.kind === 'table');
	assert.equal(exhausted.omitted, true);
	reader.begin();
	const empty = reader.read(values, 0);
	assert.ok(empty.kind === 'table');
	assert.equal(empty.omitted, false);
});

test('snapshot entry boundary distinguishes an exhausted budget from fully visited empty storage', () => {
	const { cpu } = eventHistoryRuntime(compileEventHistoryFixture());
	const reader = new GuestValueSnapshot(cpu.stringPool), values = new ValueSlots(1);
	const table = cpu.createTable(VALUE_SNAPSHOT_ENTRIES + 1, 0);
	for (let index = 1; index <= VALUE_SNAPSHOT_ENTRIES; index++) table.set(index, index);
	values.set(0, table);
	reader.begin();
	const complete = reader.read(values, 0);
	assert.ok(complete.kind === 'table');
	assert.equal(complete.entries.length, VALUE_SNAPSHOT_ENTRIES);
	assert.equal(complete.omitted, false);
	table.set(VALUE_SNAPSHOT_ENTRIES + 1, false);
	reader.begin();
	const truncated = reader.read(values, 0);
	assert.ok(truncated.kind === 'table');
	assert.equal(truncated.entries.length, VALUE_SNAPSHOT_ENTRIES);
	assert.equal(truncated.omitted, true);
});
