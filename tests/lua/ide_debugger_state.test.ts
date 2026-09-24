import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import {
	createRuntimeDebuggerState,
	resumeRuntimeDebugger,
	pushRuntimeDebuggerControlPlan,
	didExecuteRuntimeDebuggerPlan,
	discardRuntimeDebuggerPlans,
	runtimeDebuggerExecutionRequested,
	RuntimeDebuggerResumeMode,
	type RuntimeDebuggerState,
} from '../../ide/runtime/debugger_state';
import {
	registerLuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CPU_STATUS_CART_ENTRY } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { RuntimeGuestCallPlan, scheduleRuntimeGuestCall } from '../../ide/runtime/guest_call';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTaskKind, RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { compileLuaSource } from './cpu_test_harness';
import { blua32SourceRangeAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { linkTestSystemBlua32, type TestBlua32Image } from '../helpers/blua32';
import {
	createTestRuntime,
	createTestSystemImageRuntimeSourceState,
} from '../helpers/runtime_sources';

const DEBUG_SOURCE_PATH = 'debug_step.lua';
const DEBUG_MODULE_PATH = 'debug_step';
const DEBUG_RUN_CYCLE_BUDGET = 100_000;

type DebuggerHarness = {
	image: TestBlua32Image;
	runtime: Runtime;
	state: RuntimeDebuggerState;
};

function createDebuggerHarness(source: string, optLevel: 0 | 3): DebuggerHarness {
	const compiled = compileLuaSource(source, DEBUG_MODULE_PATH, optLevel);
	const image = linkTestSystemBlua32(compiled);
	const runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: DEBUG_SOURCE_PATH,
		projectRootPath: '',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: DEBUG_SOURCE_PATH,
		type: 'lua',
		src: source,
		base_src: source,
		source_path: DEBUG_SOURCE_PATH,
		normalized_source_path: DEBUG_SOURCE_PATH,
		module_path: DEBUG_MODULE_PATH,
		update_timestamp: 0,
		base_update_timestamp: 0,
		generated: false,
		program_module: true,
	});
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = {
		system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports),
		cartridgeSlots: [null, null],
	};
	return {
		image,
		runtime,
		state: createRuntimeDebuggerState(runtime, sources),
	};
}

for (const admission of ['quiescent', 'at-stop'] as const) test(`a revoked ${admission} evaluation never enters the CPU after asynchronous GPU admission`, async () => {
	const { runtime, state } = createDebuggerHarness('return function() return 42 end', 0);
	const cpu = runtime.machine.cpu;
	cpu.reset(); cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	const values: Value[] = []; cpu.readCompletionValues(values);
	const depth = cpu.getFrameDepth(), guest = new SuspendedGuestSession(runtime);
	guest.onDidInvalidate(() => assert.fail('a cancelled evaluation cannot invalidate the guest'));
	const readback = Promise.withResolvers<void>();
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: () => readback.promise } } as VideoPresenter);
	let current = true, cancelled = false;
	const pending = scheduleRuntimeGuestCall(runtime, guest, state, tasks,
		{ admission, honorUserStops: false, isCurrent: () => current, prepare: () => ({ domain: -1, closure: values[0] as Closure, args: () => [] }) },
		() => assert.fail('cancelled evaluation started'), completed => { assert.equal(completed, false); cancelled = true; }, assert.fail);
	current = false; readback.resolve(); await pending;
	assert.equal(cancelled, true); assert.equal(state.plans.controlActive, false);
	assert.equal(cpu.getFrameDepth(), depth);
});

for (const optLevel of [0, 3] as const) for (const pauseInCall of [false, true]) {
	test(`at-stop call retains the selected IRQ activation and source stop O${optLevel}, nested stop=${pauseInCall}`, async () => {
		const irqTail = DYNAMIC_RAM_BASE, gameCount = irqTail + 4;
		const source = `
function irq()
 mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
 local parked = function(value, ...)
  operation = function()
   value = value + 2
   evaluations = evaluations + 1 -- nested evaluation stop
   return value, nil, false
  end
  mem[${irqTail}] = value -- selected IRQ local
 end
 parked(40)
end
evaluations = 0
mem[${irqTail}] = 0
mem[${gameCount}] = 0
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
cop0.status = ${CPU_STATUS_CART_ENTRY}
while true do mem[${gameCount}] = mem[${gameCount}] + 1 end
`;
		const { runtime, state } = createDebuggerHarness(source, optLevel);
		const { cpu, memory, irqController } = runtime.machine;
		const resource = { domain: -1 as const, path: DEBUG_SOURCE_PATH };
		state.breakpoints.toggle(resource, source.split('\n').findIndex(line => line.includes('selected IRQ local')) + 1);
		if (pauseInCall) state.breakpoints.toggle(resource, source.split('\n').findIndex(line => line.includes('nested evaluation stop')) + 1);
		cpu.reset(); assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Yielded);
		irqController.raise(IRQ_VBLANK); assert.equal(cpu.enterPendingInterrupt(), true);
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		assert.equal(state.source.stop !== undefined, true);
		const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1), thread = cpu.activeThread;
		const exceptionDepth = cpu.readExceptionReturnFrameDepth();
		assert.ok(exceptionDepth >= 0 && depth > exceptionDepth);
		const retainedStop = state.source.stop;
		const domain = state.source.stop!.domain, inlineDepth = state.source.stop!.inlineDepth, reason = state.source.stop!.reason;
		const gameBefore = memory.readMappedU32LE(gameCount);
		const guest = new SuspendedGuestSession(runtime);
		const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
			{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
		const values: Value[] = [];
		let finished: boolean | undefined, started = 0;
		await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
			admission: 'at-stop', honorUserStops: true, isCurrent: () => true,
			prepare: () => {
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(cpu.readFramePc(depth - 1), pc);
				assert.equal(state.source.stop !== undefined, true);
				return { domain: -1, closure: guest.global('operation') as Closure, args: () => [] };
			},
		}, () => { started++; }, completed => { finished = completed; if (completed) cpu.readCompletionValues(values); }, assert.fail);
		assert.equal(started, 1);
		assert.equal(cpu.getFrameDepth(), depth + 1, 'call starts above the selected IRQ instead of draining it');
		assert.equal(cpu.readExceptionReturnFrameDepth(), exceptionDepth);
		assert.equal(state.source.stop !== undefined, false, 'only the evaluation owns execution while the outer stop is retained');
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		if (pauseInCall) {
			assert.equal(state.source.stop !== undefined, true);
			assert.notEqual(state.source.stop!.pc, pc);
			assert.equal(state.plans.controlSuspended, true);
			didExecuteRuntimeDebuggerPlan(state);
			assert.equal(finished, undefined);
			assert.equal(guest.global('evaluations'), 0, 'the nested breakpoint is before its write');
			resumeRuntimeDebugger(state, RuntimeDebuggerResumeMode.Continue);
			assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		}
		didExecuteRuntimeDebuggerPlan(state);
		assert.equal(finished, true); assert.deepEqual(values, [42, null, false]);
		assert.equal(state.plans.controlActive, false);
		assert.equal(cpu.activeThread, thread); assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), pc); assert.equal(cpu.readExceptionReturnFrameDepth(), exceptionDepth);
		assert.equal(memory.readMappedU32LE(irqTail), 0); assert.equal(memory.readMappedU32LE(gameCount), gameBefore);
		assert.equal(state.source.stop !== undefined, true); assert.equal(state.source.stop!.thread, thread);
		assert.equal(state.source.stop!.domain, domain); assert.equal(state.source.stop!.pc, pc);
		assert.equal(state.source.stop!.inlineDepth, inlineDepth); assert.equal(state.source.stop!.reason, reason);
		assert.equal(state.stopPresentationPending, true);
		assert.equal(state.source.stop, retainedStop, 'completion republishes the same suspension identity');
		resumeRuntimeDebugger(state, RuntimeDebuggerResumeMode.Continue);
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.Yielded);
		assert.equal(memory.readMappedU32LE(irqTail), 42, 'ordinary Continue observes the retained mutation');
		assert.equal(guest.global('evaluations'), 1);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
	});
}

for (const optLevel of [0, 3] as const) test(`quiescent call suppresses the stopped caller instruction, not the injected root O${optLevel}`, async () => {
	const source = `
operation = function() return 42 end
loops = 0
while loops < 2 do
 loops = loops + 1 -- caller stop
end
return loops
`;
	const harness = createDebuggerHarness(source, optLevel), { runtime, state } = harness;
	const { cpu } = runtime.machine;
	const line = source.split('\n').findIndex(line => line.includes('caller stop')) + 1;
	startAtBreakpoint(harness, line); assert.equal(stoppedSourceLine(harness), line);
	const guest = new SuspendedGuestSession(runtime), values: Value[] = [];
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
	let finished = false;
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		admission: 'quiescent', honorUserStops: true, isCurrent: () => true,
		prepare: () => ({ domain: -1, closure: guest.global('operation') as Closure, args: () => [] }),
	}, () => {}, completed => { finished = completed; cpu.readCompletionValues(values); }, assert.fail);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	didExecuteRuntimeDebuggerPlan(state);
	assert.equal(finished, true); assert.deepEqual(values, [42]);
	assert.equal(state.source.stop !== undefined, false); assert.equal(guest.global('loops'), 0);
	resumeRuntimeDebugger(state, RuntimeDebuggerResumeMode.Continue);
	assert.equal(stoppedSourceLine(harness), line);
	assert.equal(guest.global('loops'), 1, 'Continue executes the original stopped instruction once before stopping on its next visit');
});

for (const optLevel of [0, 3] as const) test(`discarding an at-stop plan does not present an unreturned caller O${optLevel}`, async () => {
	const source = `
operation = function()
 work = work + 1 -- inside call
 return work
end
work = 0
return work -- caller stop
`;
	const harness = createDebuggerHarness(source, optLevel), { runtime, state } = harness;
	const { cpu } = runtime.machine;
	const line = source.split('\n').findIndex(line => line.includes('caller stop')) + 1;
	startAtBreakpoint(harness, line); assert.equal(stoppedSourceLine(harness), line);
	const outerPc = state.source.stop!.pc, depth = cpu.getFrameDepth(), guest = new SuspendedGuestSession(runtime);
	state.breakpoints.toggle({ domain: -1, path: DEBUG_SOURCE_PATH }, source.split('\n').findIndex(line => line.includes('inside call')) + 1);
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
	const outcomes: boolean[] = [];
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		admission: 'at-stop', honorUserStops: true, isCurrent: () => true,
		prepare: () => ({ domain: -1, closure: guest.global('operation') as Closure, args: () => [] }),
	}, () => {}, completed => { outcomes.push(completed); }, assert.fail);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	didExecuteRuntimeDebuggerPlan(state);
	assert.deepEqual(outcomes, []);
	const innerPc = state.source.stop!.pc;
	assert.notEqual(innerPc, outerPc); assert.equal(cpu.getFrameDepth(), depth + 1);
	discardRuntimeDebuggerPlans(state);
	assert.deepEqual(outcomes, [false]); assert.equal(state.plans.controlActive, false);
	assert.equal(state.source.stop !== undefined, true); assert.equal(state.source.stop!.pc, innerPc);
	assert.equal(cpu.getFrameDepth(), depth + 1, 'plan retirement is not an implicit stack unwind');
	assert.equal(cpu.readFramePc(depth - 1), outerPc); assert.equal(guest.global('work'), 0);
});

for (const optLevel of [0, 3] as const) for (const cancel of [false, true]) test(`evaluation ${cancel ? 'cancels' : 'admits fresh arguments'} after the physical IRQ return (O${optLevel})`, async () => {
	const irqCount = DYNAMIC_RAM_BASE, gameCount = irqCount + 4;
	const { runtime, state } = createDebuggerHarness(`
function irq()
	mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
	mem[${irqCount}] = mem[${irqCount}] + 1
end
function exception() end
operation = function(first)
	while mem[${irqCount}] == first do halt_until_irq end
	return first, mem[${irqCount}]
end
mem[${irqCount}] = 0
mem[${gameCount}] = 0
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
cop0.status = ${CPU_STATUS_CART_ENTRY}
while true do mem[${gameCount}] = mem[${gameCount}] + 1 end
`, optLevel);
	const { cpu, memory, irqController } = runtime.machine;
	cpu.reset(); cpu.runUntilDepth(0, 1000);
	const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1), gameBefore = memory.readMappedU32LE(gameCount);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	const irqDepth = cpu.getFrameDepth();
	const guest = new SuspendedGuestSession(runtime);
	let prepared = 0, started = 0, readbacks = 0;
	let completed: boolean | undefined;
	let current = true;
	const result: Value[] = [];
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => { readbacks++; } } } as VideoPresenter);
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		admission: 'quiescent', honorUserStops: false,
		isCurrent: () => current,
		prepare: () => {
			prepared++;
			assert.equal(cpu.isUserMode(), true);
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			const first = memory.readMappedU32LE(irqCount);
			assert.equal(first, 1, 'resolve arguments after the handler, not before it');
			return { domain: -1, closure: guest.global('operation') as Closure, args: () => [first] };
		},
	}, () => { started++; }, value => { completed = value; if (value) cpu.readCompletionValues(result); }, assert.fail);
	assert.equal(prepared, 0);
	assert.equal(cpu.getFrameDepth(), irqDepth, 'do not push a completion call above the IRQ');
	state.plans.setControlSuspended(true);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	assert.equal(memory.readMappedU32LE(irqCount), 0);
	state.plans.setControlSuspended(false);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc);
	state.plans.didExecute();
	if (cancel) current = false;
	await tasks.schedule(() => {}, assert.fail, RuntimeTaskKind.History);
	assert.equal(readbacks, 2, 'IRQ-submitted GPU work precedes call admission');
	if (cancel) {
		assert.equal(prepared, 0); assert.equal(started, 1);
		assert.equal(completed, false); assert.equal(state.plans.mutationActive, false);
		assert.equal(cpu.getFrameDepth(), depth); assert.equal(cpu.readFramePc(depth - 1), pc);
		assert.equal(memory.readMappedU32LE(gameCount), gameBefore);
		return;
	}
	assert.equal(prepared, 1); assert.equal(started, 1);
	cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	assert.equal(cpu.isHaltedUntilIrq(), true, 'the operation can wait for its own interrupt');
	assert.equal(completed, undefined);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	assert.deepEqual(result, [1, 2]);
	assert.equal(completed, true);
	assert.equal(state.plans.mutationActive, false);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc, 'no ordinary game instruction runs between the IRQ and evaluation');
	assert.equal(memory.readMappedU32LE(gameCount), gameBefore);
});

for (const optLevel of [0, 3] as const) test(`workbench evaluation pauses the actual call without undoing mutations (O${optLevel})`, () => {
	const harness = createDebuggerHarness(`
local actor = { value = 0 }
local function advance(self, limit)
	while self.value < limit do self.value = self.value + 1 end
	return self.value
end
return actor, advance
`, optLevel);
	const { runtime, state } = harness;
	const cpu = runtime.machine.cpu;
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.Halted);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	const actor = values[0] as Table;
	const closure = values[1] as Closure;
	const key = cpu.stringPool.find('value')!;
	const depth = cpu.getFrameDepth();
	let completed = false;
	cpu.beginCompletionClosureInExecutionDomain(-1, closure, [actor, 100]);
	pushRuntimeDebuggerControlPlan(state, new RuntimeGuestCallPlan(runtime, depth, 'completion', false, value => { completed = value; }), 'workbench');
	cpu.runUntilDepth(depth, 80);
	const partial = actor.getStringKey(key) as number;
	assert.ok(partial > 0 && partial < 100);
	state.plans.setControlSuspended(true);
	assert.equal(runtimeDebuggerExecutionRequested(state), false);
	assert.equal(cpu.runUntilDepth(depth, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	assert.equal(actor.getStringKey(key), partial);
	assert.equal(cpu.getFrameDepth(), depth + 1);
	state.plans.setControlSuspended(false);
	assert.equal(runtimeDebuggerExecutionRequested(state), true);
	cpu.runUntilDepth(depth, DEBUG_RUN_CYCLE_BUDGET);
	state.plans.didExecute();
	assert.equal(completed, true);
	assert.equal(state.plans.mutationActive, false);
	assert.equal(actor.getStringKey(key), 100);
	assert.equal(cpu.getFrameDepth(), depth);
});

for (const optLevel of [0, 3] as const) for (const cancel of ['never', 'waiting', 'admission'] as const)
test(`guest owner admits fresh targets after its boundary, cancellation=${cancel} (O${optLevel})`, async () => {
	const source = `
function irq() mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK} end
actor = { value = 1 }
ordinary = 0
calls = 0
request_boundary = function()
	receipt = { reached = false }
	return receipt
end
operation = function(target)
	calls = calls + 1
	target.value = target.value + 1
	return target.value
end
local finish_work<const> = function()
	actor = { value = 100 }
	if receipt ~= nil then receipt.reached = true end
end
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
cop0.status = ${CPU_STATUS_CART_ENTRY}
while true do
	ordinary = ordinary + 1
	finish_work()
end
`;
	const harness = createDebuggerHarness(source, optLevel);
	const { runtime, state } = harness;
	const { cpu, irqController } = runtime.machine;
	const line = source.split('\n').findIndex(line => line.includes('actor = { value = 100 }')) + 1;
	startAtBreakpoint(harness, line); assert.equal(stoppedSourceLine(harness), line);
	const guest = new SuspendedGuestSession(runtime);
	const before = guest.global('actor');
	let current = true, prepared = 0, started = 0, entered = 0, boundaryCalls = 0, readbacks = 0;
	let completed: boolean | undefined;
	const results: Value[] = [];
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => { readbacks++; } } } as VideoPresenter);
	irqController.raise(IRQ_VBLANK); assert.equal(cpu.enterPendingInterrupt(), true);
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		admission: 'quiescent', honorUserStops: false,
		isCurrent: () => current,
		didEnter: () => { entered++; assert.equal(runtime.completionCallPending(), true); },
		boundary: () => {
			boundaryCalls++;
			return { request: { domain: -1, closure: guest.global('request_boundary') as Closure, args: () => [] },
				condition: values => {
					const receipt = values[0] as Table, key = cpu.stringPool.find('reached')!;
					return () => receipt.getStringKey(key) === true;
				} };
		},
		prepare: () => {
			prepared++;
			const target = guest.global('actor');
			assert.notEqual(target, before, 'resolve the replacement, never the popup borrow');
			return { domain: -1, closure: guest.global('operation') as Closure, args: () => [target] };
		},
	}, () => { started++; }, value => { completed = value; if (value) cpu.readCompletionValues(results); }, assert.fail);
	const execute = async () => {
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		state.plans.didExecute();
		await tasks.schedule(() => {}, assert.fail, RuntimeTaskKind.History);
	};
	await execute(); // IRQ, then request receipt.
	await execute(); // Request returns; the original pass has not advanced.
	assert.equal(boundaryCalls, 1); assert.equal(prepared, 0); assert.equal(entered, 0, 'receipt call is not final invocation');
	assert.equal(guest.global('actor'), before);
	state.plans.setControlSuspended(true);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	assert.equal(guest.global('actor'), before, 'Pause Lua Call also pauses boundary admission');
	state.plans.setControlSuspended(false);
	if (cancel === 'waiting') current = false;
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	if (cancel === 'admission') current = false;
	await tasks.schedule(() => {}, assert.fail, RuntimeTaskKind.History);
	assert.equal(started, 1);
	assert.equal(guest.global('ordinary'), 1, 'stop at the owner boundary, before another game iteration');
	if (cancel !== 'never') {
		assert.equal(completed, false); assert.equal(prepared, 0); assert.equal(entered, 0);
		assert.equal(guest.global('calls'), 0, 'a revoked request leaves no queued edit in the guest');
		assert.equal(state.plans.mutationActive, false);
		return;
	}
	assert.equal(prepared, 1); assert.equal(entered, 1);
	assert.equal(readbacks, 4, 'synchronize GPU work after IRQ, receipt submission and boundary');
	await execute();
	assert.equal(completed, true); assert.deepEqual(results, [101]);
	assert.equal(guest.global('calls'), 1); assert.equal(state.plans.mutationActive, false);
});

for (const optLevel of [0, 3] as const) test(`guest boundary works in RAM code without linked symbols (O${optLevel})`, async () => {
	const functionAddress = DYNAMIC_RAM_BASE + 0x1000, codeAddress = functionAddress + 0x100;
	const { runtime, state } = createDebuggerHarness(`
passes = 0
ram_body = function()
	passes = passes + 1
	if receipt ~= nil then receipt.reached = true end
end
request_boundary = function() receipt = { reached = false }; return receipt end
operation = function() return passes end
return function()
	ram_function = blua32.closure(${functionAddress})
	ram_function()
	passes = 100
end
`, optLevel);
	const { cpu, memory } = runtime.machine;
	cpu.reset(); assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.Halted);
	const values: Value[] = []; cpu.readCompletionValues(values);
	const driver = values[0] as Closure;
	const guest = new SuspendedGuestSession(runtime);
	const source = (guest.global('ram_body') as Closure).functionAddress;
	const record = new Uint8Array(BLUA32_FUNCTION_RECORD_SIZE);
	memory.readBytesInto(source, record, record.length);
	const code = new Uint8Array(memory.readMappedU32LE(source + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET));
	memory.readBytesInto(memory.readMappedU32LE(source + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET), code, code.length);
	memory.writeBytes(functionAddress, record);
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, codeAddress);
	memory.writeBytes(codeAddress, code);
	cpu.beginCompletionCall(driver);
	for (let i = 0; i < 100 && cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1) !== functionAddress; i++) cpu.runUntilDepth(0, 1);
	assert.equal(cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1), functionAddress);
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
	let completed = false;
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		admission: 'quiescent', honorUserStops: false,
		isCurrent: () => true,
		boundary: () => ({ request: { domain: -1, closure: guest.global('request_boundary') as Closure, args: () => [] },
			condition: values => { const receipt = values[0] as Table, key = cpu.stringPool.find('reached')!;
				return () => receipt.getStringKey(key) === true; } }),
		prepare: () => ({ domain: -1, closure: guest.global('operation') as Closure, args: () => [] }),
	}, () => {}, ready => { completed = ready; cpu.readCompletionValues(values); }, assert.fail);
	for (let phase = 0; phase < 3; phase++) {
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		state.plans.didExecute();
		await tasks.schedule(() => {}, assert.fail, RuntimeTaskKind.History);
	}
	assert.equal(completed, true); assert.deepEqual(values, [1]);
	assert.equal(guest.global('passes'), 1, 'no instruction beyond the published boundary');
});

function stoppedSourceLine(harness: DebuggerHarness): number {
	const result = harness.runtime.machine.cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	assert.equal(result, RunResult.ExecutionStopped);
	assert.equal(harness.state.source.stop !== undefined, true);
	return blua32SourceRangeAtPc(
		harness.image.symbols,
		harness.image.image.header.textAddress,
		harness.state.source.stop!.pc,
	)!.start.line;
}

for (const optLevel of [0, 3] as const) for (const honorUserStops of [false, true])
test(`scheduled evaluation ${honorUserStops ? 'honors' : 'suppresses'} user breakpoints (O${optLevel})`, () => {
	const { runtime, state } = createDebuggerHarness('return function(value)\n value = value + 1\n return value\nend', optLevel);
	const cpu = runtime.machine.cpu, values: Value[] = [];
	cpu.reset(); cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET); cpu.readCompletionValues(values);
	state.breakpoints.set({ domain: -1, path: DEBUG_SOURCE_PATH }, [2]);
	assert.ok(state.breakpoints.bindings.pcs[0].size > 0, 'the real source has an emitted breakpoint PC');
	let finished = 0;
	cpu.beginCompletionClosureInExecutionDomain(-1, values[0] as Closure, [1]);
	pushRuntimeDebuggerControlPlan(state, new RuntimeGuestCallPlan(runtime, 0, 'completion', honorUserStops, completed => {
		assert.equal(completed, true); finished++;
	}), 'workbench');
	const result = cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	if (honorUserStops) {
		assert.equal(result, RunResult.ExecutionStopped);
		assert.equal(state.source.stop !== undefined, true);
		assert.equal(state.plans.controlSuspended, true);
		assert.equal(state.plans.mutationActive, true);
		assert.equal(runtimeDebuggerExecutionRequested(state), false);
		state.plans.didExecute();
		assert.equal(finished, 0, 'a source breakpoint does not complete or discard the call');
		const pc = cpu.readFramePc(0);
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		assert.equal(cpu.readFramePc(0), pc, 'stopped call remains held without CPU progress');
		resumeRuntimeDebugger(state, RuntimeDebuggerResumeMode.Continue);
		assert.equal(state.plans.controlSuspended, false);
		cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	} else assert.equal(state.source.stop !== undefined, false);
	state.plans.didExecute();
	cpu.readCompletionValues(values);
	assert.equal(finished, 1);
	assert.equal(state.plans.mutationActive, false);
	assert.deepEqual(values, [2]);
});

function startAtBreakpoint(harness: DebuggerHarness, line: number): void {
	harness.state.breakpoints.set({ domain: SYSTEM_RESOURCE_DOMAIN, path: DEBUG_SOURCE_PATH }, [line]);
	harness.runtime.machine.cpu.reset();
}

function resumeAndStop(
	harness: DebuggerHarness,
	mode: RuntimeDebuggerResumeMode,
): number {
	resumeRuntimeDebugger(harness.state, mode);
	return stoppedSourceLine(harness);
}

test('runtime breakpoint state is owned by each IDE session', () => {
	const first = createDebuggerHarness('return 1', 0).state;
	const second = createDebuggerHarness('return 1', 0).state;
	first.breakpoints.set({ domain: -1, path: DEBUG_SOURCE_PATH }, [1]);
	assert.deepEqual(first.breakpoints.get({ domain: -1, path: DEBUG_SOURCE_PATH }), new Set([1]));
	assert.deepEqual(second.breakpoints.serialize(), []);
});

test('statement stepping follows physical Lua call frames', () => {
	const source = [
		'local output = {}',
		'local function child(value)',
		'\toutput[1] = value',
		'\toutput[2] = value + 1',
		'\treturn output[2]',
		'end',
		'local function parent(value)',
		'\toutput[3] = value',
		'\tlocal result = child(value)',
		'\toutput[4] = result',
		'\treturn result',
		'end',
		'return parent(41)',
	].join('\n');
	const harness = createDebuggerHarness(source, 0);
	startAtBreakpoint(harness, 8);

	assert.equal(stoppedSourceLine(harness), 8);
	assert.equal(
		resumeAndStop(harness, RuntimeDebuggerResumeMode.StepOver),
		9,
	);
	assert.equal(
		resumeAndStop(harness, RuntimeDebuggerResumeMode.StepInto),
		3,
	);
	assert.equal(
		resumeAndStop(harness, RuntimeDebuggerResumeMode.StepOut),
		10,
	);
});

test('statement stepping follows optimized inline call frames', () => {
	const source = [
		'local output = {}',
		'local child<const> = function(value)',
		'\toutput[1] = value',
		'\toutput[2] = value + 1',
		'\treturn output[2]',
		'end',
		'local parent<const> = function(value)',
		'\toutput[3] = value',
		'\tlocal result = child(value)',
		'\toutput[4] = result',
		'\treturn result',
		'end',
		'return parent(41)',
	].join('\n');
	const stepOverHarness = createDebuggerHarness(source, 3);
	startAtBreakpoint(stepOverHarness, 8);

	assert.equal(stoppedSourceLine(stepOverHarness), 8);
	assert.equal(stepOverHarness.state.source.stop!.inlineDepth, 1);
	assert.equal(
		resumeAndStop(stepOverHarness, RuntimeDebuggerResumeMode.StepOver),
		10,
	);
	assert.equal(stepOverHarness.state.source.stop!.inlineDepth, 1);

	const stepIntoHarness = createDebuggerHarness(source, 3);
	startAtBreakpoint(stepIntoHarness, 8);
	assert.equal(stoppedSourceLine(stepIntoHarness), 8);
	assert.equal(
		resumeAndStop(stepIntoHarness, RuntimeDebuggerResumeMode.StepInto),
		3,
	);
	assert.equal(stepIntoHarness.state.source.stop!.inlineDepth, 2);
	assert.equal(
		resumeAndStop(stepIntoHarness, RuntimeDebuggerResumeMode.StepOut),
		10,
	);
	assert.equal(stepIntoHarness.state.source.stop!.inlineDepth, 1);
});

for (const optLevel of [0, 3] as const) test(`completion-root identity survives a parked caller accepting IRQ (O${optLevel})`, () => {
	const irqCount = DYNAMIC_RAM_BASE;
	const { runtime, state } = createDebuggerHarness(`
function irq()
	mem[${irqCount}] = mem[${irqCount}] + 1
	mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
end
function exception() end
operation = function() return 42 end
mem[${irqCount}] = 0
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
cop0.status = ${CPU_STATUS_CART_ENTRY}
while true do halt_until_irq end
`, optLevel);
	const { cpu, memory, irqController } = runtime.machine;
	cpu.reset(); cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	const depth = cpu.getFrameDepth(), guest = new SuspendedGuestSession(runtime);
	cpu.beginCompletionClosureInExecutionDomain(-1, guest.global('operation') as Closure, []);
	let completed = false;
	pushRuntimeDebuggerControlPlan(state, new RuntimeGuestCallPlan(runtime, depth, 'completion', true, value => { completed = value; }), 'workbench');
	cpu.runUntilDepth(depth, DEBUG_RUN_CYCLE_BUDGET);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	// Ordinary scheduler wakeup can enter IRQ before didExecute observes the call.
	irqController.raise(IRQ_VBLANK); assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.getFrameDepth(), depth + 1);
	assert.equal(cpu.readFrameReturnsToCompletionLatch(depth), false);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	assert.equal(completed, true); assert.equal(state.source.stop !== undefined, false);
	assert.equal(memory.readMappedU32LE(irqCount), 0, 'completion stops before an unrelated IRQ instruction');
	const values: Value[] = []; cpu.readCompletionValues(values); assert.deepEqual(values, [42]);
});

for (const level of [0, 3] as const) for (const transition of ['source-install', 'hot-resume', 'reset'] as const) test(`O${level}: an evaluation cannot republish a source stop after ${transition}`, async () => {
	const { runtime, state } = createDebuggerHarness(`operation = function() return 42 end\nlocal value = 17\nmem[${DYNAMIC_RAM_BASE}] = value\nreturn value`, level);
	state.breakpoints.set({ domain: -1, path: DEBUG_SOURCE_PATH }, [3]);
	const cpu = runtime.machine.cpu;
	cpu.reset(); assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.ExecutionStopped);
	const retained = state.source.stop;
	const guest = new SuspendedGuestSession(runtime);
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
	let completed = false;
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		admission: 'at-stop', honorUserStops: true, isCurrent: () => true,
		prepare: () => ({ domain: -1, closure: guest.global('operation') as Closure, args: () => [] }),
	}, () => {}, result => { completed = result; }, assert.fail);
	if (transition === 'source-install') {
		state.sources.currentBlua32Media = { ...state.sources.currentBlua32Media };
		state.source.install(state.sources.currentBlua32Media, state.breakpoints.bindings.pcs);
	} else if (transition === 'hot-resume') state.source.resumeAfterRecompile(false);
	else state.source.reset();
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.ExecutionStopped);
	didExecuteRuntimeDebuggerPlan(state);
	assert.equal(completed, true);
	assert.notEqual(state.source.stop, retained);
	assert.equal(state.source.stop, undefined, 'the replacement ended that source suspension even if the guest call returned normally');
});
