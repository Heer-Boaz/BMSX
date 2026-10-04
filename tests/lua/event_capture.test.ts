import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindFunctionProbe } from '../../ide/runtime/function_probe';
import { GuestValueSnapshot } from '../../ide/runtime/value_snapshot';
import { ExecutionHookPhase, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { executionDomainBit } from '../../machine/ts/spec/blua32/execution_domain';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { compileEventCaptureFixture, eventCaptureRuntime } from '../helpers/event_capture';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { applyRuntimeDebuggerHotResume, resetRuntimeDebuggerExecution, RuntimeDebuggerResumeMode } from '../../ide/runtime/debugger_state';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { EventProjection } from '../../ide/workbench/contrib/events/presentation';
import { VALUE_SNAPSHOT_ENTRIES, VALUE_SNAPSHOT_CHARACTERS } from '../../ide/runtime/value_snapshot';
import { compileLuaSource } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime } from '../helpers/runtime_sources';

const BUDGET = 10_000_000;

test('function probes bind separate inline callsites and reject optimized-away arguments', () => {
	const source = `local child<const> = function(value)
  value[1] = value[1] + 1
  return value[1]
end
payload = { 10 }
child(payload)
return child(payload)`;
	const image = linkTestSystemBlua32(compileLuaSource(source, 'probe.lua', 3));
	const media = { layout: image.image, symbols: image.symbols };
	const binding = bindFunctionProbe(media, 'probe', 'child', ['value']);
	assert.equal(binding.status, 'bound'); if (binding.status !== 'bound') return;
	assert.ok(binding.points.length > 1, 'physical and inline invocations have distinct entry points');
	const cpu = createTestRuntime(image.romBytes).machine.cpu;
	const snapshot = new GuestValueSnapshot(cpu.stringPool), captured: string[] = [];
	const points = new Map(binding.points.map(point => [point.pc, point]));
	cpu.reset();
	cpu.setExecutionHook((_domain, pc, phase) => {
		const point = points.get(pc);
		if (point !== undefined && phase === ExecutionHookPhase.Instruction) {
			snapshot.begin();
			captured.push(snapshot.read(cpu.readFrameRegister(cpu.getFrameDepth() - 1, point.registers[0])).entries[0].value.display);
		}
		return false;
	}, executionDomainBit(-1), 0);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.deepEqual(captured, ['10', '11']);
	assert.equal(bindFunctionProbe({ layout: image.image, symbols: null }, 'probe', 'child', ['value']).status, 'symbols-unavailable');
	assert.equal(bindFunctionProbe(media, 'not_probe', 'child', ['value']).status, 'function-unavailable');
	assert.equal(bindFunctionProbe(media, 'probe', 'child', ['not_a_parameter']).status, 'arguments-unavailable');
	const optimized = linkTestSystemBlua32(compileLuaSource(source.replaceAll('value[1]', 'value').replace('{ 10 }', '10'), 'probe.lua', 3));
	assert.equal(bindFunctionProbe({ layout: optimized.image, symbols: optimized.symbols }, 'probe', 'child', ['value']).status, 'arguments-unavailable');
});

for (const optLevel of [0, 3] as const) test(`event probes see real dispatch arguments before nested handlers and mutation (O${optLevel})`, () => {
	const { cpu, images } = createCartlibProgramHarness(`
local events<const> = require('cartlib/event_emitter')
local actor<const> = { id = 'player' }
local port<const> = events.events_of(actor)
local data<const> = { health = 9, position = { x = 4 }, label = 'before' }
data.self = data
local listener<const> = {}
events:on({ event = 'outer', subscriber = listener, handler = function(_, _, _, payload)
  port:emit('inner', false)
  payload.health = 1
  payload.label = 'after'
end })
port:emit('outer', data)
port:emit('unhandled', nil)
return data.health`, { optLevel });
	const binding = bindFunctionProbe({ layout: images.cartImage, symbols: images.cartSymbols },
		'cartlib/event_emitter', 'event_emitter.emit', ['event_type', 'emitter_id', 'payload']);
	assert.equal(binding.status, 'bound'); if (binding.status !== 'bound') return;
	const points = new Map(binding.points.map(point => [point.pc, point]));
	const snapshot = new GuestValueSnapshot(cpu.stringPool), captured: ReturnType<GuestValueSnapshot['read']>[][] = [];
	cpu.setExecutionHook((_domain, pc, phase) => {
		const point = points.get(pc);
		if (phase === ExecutionHookPhase.Instruction && point !== undefined) {
			snapshot.begin();
			captured.push(point.registers.map(register => snapshot.read(cpu.readFrameRegister(cpu.getFrameDepth() - 1, register))));
		}
		return false;
	}, executionDomainBit(0), 0);
	assert.equal(cpu.runUntilDepth(0, 2_000_000), RunResult.Halted);
	assert.deepEqual(captured.map(record => record[0].display), ['"outer"', '"inner"', '"unhandled"']);
	assert.equal(captured[0][1].display, '"player"');
	assert.equal(captured[1][2].display, 'false'); assert.equal(captured[2][2].display, 'nil');
	const data = captured[0][2];
	assert.equal(data.entries.find(entry => entry.key.display === '"health"')!.value.display, '9');
	assert.equal(data.entries.find(entry => entry.key.display === '"label"')!.value.display, '"before"');
	assert.match(data.entries.find(entry => entry.key.display === '"self"')!.value.display, /^reference #/);
});

test('recording coexists with source stops, retires at history/install boundaries, and bounds retained history', () => {
	const images = compileEventCaptureFixture();
	const { cpu, runtime, debuggerState: state, events, sources } = eventCaptureRuntime(images);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	const binding = bindFunctionProbe(sources.currentBlua32Media.cartridgeSlots[0]!, 'cartlib/event_emitter', 'event_emitter.emit', ['payload']);
	assert.equal(binding.status, 'bound'); if (binding.status !== 'bound') return;
	const point = binding.points[0];
	state.source.install(sources.currentBlua32Media, [new Map(), new Map([[point.pc, 0]]), new Map()]);
	assert.equal(events.start(), 'recording');
	cpu.beginCompletionCall(fn, [1]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.ExecutionStopped);
	assert.equal(events.records.length, 0, 'a stopped entry has not emitted');
	const stoppedCycles = BUDGET - cpu.instructionBudgetRemaining;
	runtime.machine.scheduler.advanceTo(stoppedCycles);
	state.source.resume(RuntimeDebuggerResumeMode.Continue);
	state.executionHook(0, point.pc, ExecutionHookPhase.BeforeMaskableInterrupt);
	assert.equal(events.records.length, 0, 'an interrupt control fence cannot record');
	state.source.install(sources.currentBlua32Media, [new Map(), new Map(), new Map()]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	assert.equal(events.records.length, 1);
	assert.equal(events.records[0].payload.entries.find(entry => entry.key.display === '"value"')!.value.display, '1');
	assert.equal(events.records[0].cycles, stoppedCycles);
	resetRuntimeDebuggerExecution(state);
	assert.equal(events.status, 'runtime-changed'); assert.equal(events.domainMask, 0); assert.equal(events.records.length, 1);
	runtime.history.mode = HistoryMode.Reviewing;
	assert.equal(events.start(), 'history-review'); assert.equal(events.domainMask, 0);
	runtime.history.mode = HistoryMode.Disabled;
	assert.equal(events.start(), 'recording');
	applyRuntimeDebuggerHotResume(state, state.breakpoints.bindings);
	assert.equal(events.status, 'runtime-changed');
	assert.equal(events.start(), 'recording');
	cpu.beginCompletionCall(fn, [events.capacity + 3]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	assert.equal(events.records.length, events.capacity); assert.equal(events.status, 'full'); assert.equal(events.domainMask, 0);
	const projection = new EventProjection();
	assert.equal(projection.update(events, 'fixture'), true); assert.equal(projection.rows.length, events.capacity);
	assert.equal(projection.update(events, 'fixture'), false);
	assert.equal(events.start(), 'full');
	events.clear(); assert.equal(events.records.length, 0); projection.update(events, 'fixture'); assert.equal(projection.rows.length, 0);
	assert.equal(events.start(), 'recording');
	cpu.beginCompletionCall(fn, [1]); cpu.runUntilDepth(0, BUDGET);
	projection.update(events, 'fixture'); assert.equal(projection.rows.length, 1);
	assert.ok(projection.rows[0].sequence >= events.capacity);
	events.stop(); assert.equal(events.domainMask, 0);
});

test('snapshot entry and text budgets are explicit and never evaluate metatables', () => {
	const { cpu, images } = createCartlibProgramHarness(`
local events<const> = require('cartlib/event_emitter')
local payload<const> = setmetatable({}, { __index = function() error('must not inspect through index') end })
for i=1,100 do payload[i] = string.rep('x', 5000) end
events:emit('large', nil, payload, 'fixture')`);
	const binding = bindFunctionProbe({ layout: images.cartImage, symbols: images.cartSymbols }, 'cartlib/event_emitter', 'event_emitter.emit', ['payload']);
	assert.equal(binding.status, 'bound'); if (binding.status !== 'bound') return;
	const point = binding.points[0], snapshot = new GuestValueSnapshot(cpu.stringPool);
	let value: ReturnType<GuestValueSnapshot['read']>;
	cpu.setExecutionHook((_domain, pc) => {
		if (pc === point.pc) { snapshot.begin(); value = snapshot.read(cpu.readFrameRegister(cpu.getFrameDepth() - 1, point.registers[0])); }
		return false;
	}, executionDomainBit(0), 0);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.equal(value!.entries.length, VALUE_SNAPSHOT_ENTRIES); assert.equal(value!.omitted, true);
	assert.equal(value!.entries[0].value.display.length, VALUE_SNAPSHOT_CHARACTERS + 2);
	assert.equal(value!.entries[0].value.omitted, true);
});

test('capture leaves guest instruction cost unchanged; measure enabled host cost separately', t => {
	const images = compileEventCaptureFixture(), runtimes = [eventCaptureRuntime(images), eventCaptureRuntime(images)];
	const elapsed: number[][] = [[], []], costs: number[] = [], heapBytes: number[] = [];
	for (let variant = 0; variant < runtimes.length; variant++) {
		const { cpu, runtime, events } = runtimes[variant];
		cpu.runUntilDepth(0, BUDGET);
		const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
		for (let repeat = 0; repeat < 7; repeat++) {
			events.clear(); if (variant === 1) events.start();
			cpu.beginCompletionCall(fn, [1000]);
			const start = performance.now();
			assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
			elapsed[variant].push(performance.now() - start);
			costs[variant] = BUDGET - cpu.instructionBudgetRemaining;
			heapBytes[variant] = cpu.luaHeap.usedBytes();
			assert.equal(events.records.length, variant === 0 ? 0 : 1000); events.stop();
		}
	}
	assert.equal(costs[0], costs[1]);
	assert.equal(heapBytes[0], heapBytes[1]);
	const medians = elapsed.map(samples => samples.slice(2).sort((a, b) => a - b)[2]);
	t.diagnostic(JSON.stringify({ guestCycles: costs[0], guestHeapBytes: heapBytes[0], disabledMs: medians[0], recordingMs: medians[1], ratio: medians[1] / medians[0] }));
});
