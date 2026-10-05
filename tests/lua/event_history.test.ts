import { readFileSync } from 'node:fs';
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

const BUDGET = 10_000_000;

for (const renamed of [false, true]) for (const optLevel of [0, 3] as const) test(`source-bound observer captures real nested/unhandled events before mutation without source-debug stepping (O${optLevel}, renamed ${renamed})`, () => {
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
return data.health`, { optLevel, modules: renamed ? [{
		path: 'cartlib/event_emitter',
		source: readFileSync('cartlib/event_emitter.lua', 'utf8')
			.replace(/\b(event_type|emitter|payload|emitter_id)\b/g, name => `renamed_${name}`),
	}] : [] });
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

test('snapshot budgets mark omission without invoking guest metatables', () => {
	const { images } = createCartlibProgramHarness(`local e<const> = require('cartlib/event_emitter')
local payload<const> = setmetatable({}, { __index = function() error('must not execute') end })
for i=1,100 do payload[i] = string.rep('x', 5000) end
e:emit('large', nil, payload, 'fixture')`);
	const { cpu, runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeEventHistory(runtime, sources);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	const snapshot = history.at(0).payload;
	assert.ok(snapshot.kind === 'table');
	assert.equal(snapshot.entries.length, VALUE_SNAPSHOT_ENTRIES);
	assert.equal(snapshot.omitted, true);
	const value = snapshot.entries[0].value;
	assert.ok(value.kind === 'string');
	assert.equal(value.value.length, VALUE_SNAPSHOT_CHARACTERS - 'large'.length - 'fixture'.length);
	assert.equal(value.omitted, true);
});

test('observation preserves guest cycles, heap and complete CPU state', () => {
	const images = compileEventHistoryFixture();
	const baseline = eventHistoryRuntime(images), observed = eventHistoryRuntime(images);
	const events = new RuntimeEventHistory(observed.runtime, observed.sources);
	for (const { cpu } of [baseline, observed]) {
		assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
		const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
		cpu.beginCompletionCall(fn, [1000]);
		assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	}
	assert.equal(events.count, 1000);
	assert.equal(observed.cpu.instructionBudgetRemaining, baseline.cpu.instructionBudgetRemaining);
	assert.equal(observed.cpu.luaHeap.usedBytes(), baseline.cpu.luaHeap.usedBytes());
	assert.deepEqual(observed.cpu.captureRuntimeState(), baseline.cpu.captureRuntimeState());
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

test('string snapshots retain exact UTF-16 units across pool restore and scratch reuse', () => {
	const { cpu } = eventHistoryRuntime(compileEventHistoryFixture());
	const pool = cpu.stringPool, saved = pool.captureState();
	const reader = new GuestValueSnapshot(pool), values = new ValueSlots(1);
	// Neither UTF-8 nor TextDecoder roundtrips preserve all of these code units.
	const text = '\uFEFF\0\uD800z\uDC00\uD83D\uDE80é\r\n';
	reader.begin();
	values.setStringId(0, pool.intern(text));
	const complete = reader.read(values, 0);
	const remaining = VALUE_SNAPSHOT_CHARACTERS - text.length;
	values.setStringId(0, pool.intern('x'.repeat(remaining - 1) + '\uD83D\uDE80'));
	const truncated = reader.read(values, 0);
	const exhausted = reader.read(values, 0);
	values.clear(1);
	pool.restoreState(saved);
	reader.begin();
	values.setStringId(0, pool.intern('new value'));
	reader.read(values, 0);
	assert.deepEqual(complete, { kind: 'string', value: text, omitted: false });
	assert.deepEqual(truncated, { kind: 'string', value: 'x'.repeat(remaining - 1) + '\uD83D', omitted: true });
	assert.deepEqual(exhausted, { kind: 'string', value: '', omitted: true });
	assert.deepEqual(JSON.parse(JSON.stringify([complete, truncated])), [complete, truncated]);
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
