import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import {
	createRuntimeDebuggerState,
	rebuildRuntimeBreakpointPcs,
	resumeRuntimeDebugger,
	pushRuntimeDebuggerControlPlan,
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
import { runtimeFunctionReturnTarget, runtimeReturnTargetReached } from '../../ide/runtime/function_return';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTaskKind, RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
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

test('a revoked evaluation never enters the CPU after asynchronous GPU admission', async () => {
	const { runtime, state } = createDebuggerHarness('return function() return 42 end', 0);
	const cpu = runtime.machine.cpu;
	cpu.reset(); cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	const values: Value[] = []; cpu.readCompletionValues(values);
	const depth = cpu.getFrameDepth(), guest = new SuspendedGuestSession(runtime);
	guest.onDidInvalidate(() => assert.fail('a cancelled evaluation cannot invalidate the guest'));
	const readback = Promise.withResolvers<void>();
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: () => readback.promise } } as VideoPresenter);
	let current = true, cancelled = false;
	const pending = scheduleRuntimeGuestCall(runtime, guest, state, tasks,
		{ isCurrent: () => current, prepare: () => ({ domain: -1, closure: values[0] as Closure, args: () => [] }) },
		() => assert.fail('cancelled evaluation started'), completed => { assert.equal(completed, false); cancelled = true; }, assert.fail);
	current = false; readback.resolve(); await pending;
	assert.equal(cancelled, true); assert.equal(state.plans.controlActive, false);
	assert.equal(cpu.getFrameDepth(), depth);
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
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => { readbacks++; } } } as VideoPresenter);
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
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
	pushRuntimeDebuggerControlPlan(state, new RuntimeGuestCallPlan(runtime, { frameDepth: depth }, value => { completed = value; }), 'workbench');
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

for (const optLevel of [0, 3] as const) test(`evaluation finishes a non-reentrant logical frame, not its next invocation (O${optLevel})`, async () => {
	const source = `
function irq() mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK} end
shared = { active = false, passes = 0, ordinary = 0 }
local leaf<const> = function()
	shared.phase = 1
	shared.phase = 2
end
local render<const> = function()
	shared.active = true
	leaf()
	shared.passes = shared.passes + 1
	shared.active = false
end
render_function = render
leaf_function = leaf
operation = function()
	return shared.active, shared.passes, shared.phase, shared.ordinary
end
mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
cop0.status = ${CPU_STATUS_CART_ENTRY}
while true do
	render()
	render()
	shared.ordinary = shared.ordinary + 1
end
`;
	const harness = createDebuggerHarness(source, optLevel);
	const { runtime, state } = harness;
	const { cpu, irqController } = runtime.machine;
	const line = source.split('\n').findIndex(line => line.includes('shared.phase = 2')) + 1;
	startAtBreakpoint(harness, line);
	assert.equal(stoppedSourceLine(harness), line);
	const guest = new SuspendedGuestSession(runtime);
	const location = guest.linkedFunctionLocation(guest.global('render_function'))!;
	const target = runtimeFunctionReturnTarget(cpu, state.sources, location)!;
	assert.equal(target.inline !== undefined, optLevel === 3, 'exercise actual compiled inline frames');
	assert.equal(runtimeReturnTargetReached(cpu, target), false);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	let prepared = 0, started = 0, finished = 0, readbacks = 0;
	const values: Value[] = [];
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => { readbacks++; } } } as VideoPresenter);
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		isCurrent: () => true,
		waitForReturn: () => [guest.linkedFunctionLocation(guest.global('leaf_function'))!, location],
		prepare: () => {
			prepared++;
			assert.equal(runtimeReturnTargetReached(cpu, target), true);
			return { domain: -1, closure: guest.global('operation') as Closure, args: () => [] };
		},
	}, () => { started++; }, completed => { assert.equal(completed, true); finished++; cpu.readCompletionValues(values); }, assert.fail);
	for (let phase = 0; phase < 2; phase++) {
		assert.equal(prepared, 0);
		assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
		state.plans.didExecute();
		await tasks.schedule(() => {}, assert.fail, RuntimeTaskKind.History);
	}
	assert.equal(prepared, 1); assert.equal(started, 1); assert.equal(readbacks, 3);
	const depth = cpu.getFrameDepth() - 1, pc = cpu.readFramePc(depth - 1);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	assert.equal(finished, 1); assert.deepEqual(values, [false, 1, 2, 0]);
	assert.equal(cpu.getFrameDepth(), depth); assert.equal(cpu.readFramePc(depth - 1), pc);
});

for (const optLevel of [0, 3] as const) test(`evaluation finishes a RAM function without requiring linked source (O${optLevel})`, async () => {
	const functionAddress = DYNAMIC_RAM_BASE + 0x1000, codeAddress = functionAddress + 0x100;
	const { runtime, state } = createDebuggerHarness(`
passes = 0
ram_body = function() passes = passes + 1 end
operation = function() return passes end
return function()
	ram_function = blua32.closure(${functionAddress})
	ram_function()
	passes = 100
end
`, optLevel);
	const { cpu, memory } = runtime.machine;
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.Halted);
	const values: Value[] = []; cpu.readCompletionValues(values);
	const driver = values[0] as Closure;
	const guest = new SuspendedGuestSession(runtime);
	const source = guest.linkedFunctionLocation(guest.global('ram_body'))!.address;
	const record = new Uint8Array(BLUA32_FUNCTION_RECORD_SIZE);
	memory.readBytesInto(source, record, record.length);
	const code = new Uint8Array(memory.readMappedU32LE(source + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET));
	memory.readBytesInto(memory.readMappedU32LE(source + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET), code, code.length);
	memory.writeBytes(functionAddress, record);
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, codeAddress);
	memory.writeBytes(codeAddress, code);
	cpu.beginCompletionCall(driver);
	for (let step = 0; step < 100 && cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1) !== functionAddress; step++) {
		cpu.runUntilDepth(0, 1);
	}
	assert.equal(cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1), functionAddress);
	assert.equal(guest.global('passes'), 0);
	const location = guest.functionLocation(guest.global('ram_function'))!;
	assert.deepEqual(location, { domain: null, address: functionAddress });
	assert.equal(guest.linkedFunctionLocation(guest.global('ram_function')), undefined);
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
	let prepared = false, finished = false;
	await scheduleRuntimeGuestCall(runtime, guest, state, tasks, {
		isCurrent: () => true, waitForReturn: () => [location],
		prepare: () => {
			prepared = true;
			assert.equal(guest.global('passes'), 1, 'finish RAM code before admitting the evaluation');
			return { domain: -1, closure: guest.global('operation') as Closure, args: () => [] };
		},
	}, () => {}, completed => { finished = completed; cpu.readCompletionValues(values); }, assert.fail);
	assert.equal(prepared, false);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	await tasks.schedule(() => {}, assert.fail, RuntimeTaskKind.History);
	assert.equal(prepared, true);
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	assert.equal(finished, true); assert.deepEqual(values, [1]);
	assert.equal(guest.global('passes'), 1, 'the outer caller must remain suspended');
});

for (const optLevel of [0, 3] as const) test(`function-return admission waits for the outer recursive invocation (O${optLevel})`, () => {
	const source = `
passes = 0
local recurse
recurse = function(depth)
	if depth > 0 then recurse(depth - 1) end
	passes = passes + 1
end
render_function = recurse
recurse(2)
passes = 100
`;
	const harness = createDebuggerHarness(source, optLevel);
	const { runtime, state } = harness, cpu = runtime.machine.cpu;
	const line = source.split('\n').findIndex(line => line.includes('passes = passes + 1')) + 1;
	startAtBreakpoint(harness, line);
	assert.equal(stoppedSourceLine(harness), line);
	const guest = new SuspendedGuestSession(runtime);
	const target = runtimeFunctionReturnTarget(cpu, state.sources, guest.linkedFunctionLocation(guest.global('render_function'))!)!;
	assert.ok(cpu.getFrameDepth() > target.frameDepth + 1);
	let finished = false;
	pushRuntimeDebuggerControlPlan(state, new RuntimeGuestCallPlan(runtime, target, completed => { finished = completed; }), 'workbench');
	assert.equal(cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET), RunResult.ExecutionStopped);
	state.plans.didExecute();
	assert.equal(finished, true); assert.equal(guest.global('passes'), 3);
	assert.equal(runtimeFunctionReturnTarget(cpu, state.sources, guest.linkedFunctionLocation(guest.global('render_function'))!), undefined);
});

function stoppedSourceLine(harness: DebuggerHarness): number {
	const result = harness.runtime.machine.cpu.runUntilDepth(0, DEBUG_RUN_CYCLE_BUDGET);
	assert.equal(result, RunResult.ExecutionStopped);
	assert.equal(harness.state.stopped, true);
	return blua32SourceRangeAtPc(
		harness.image.symbols,
		harness.image.image.header.textAddress,
		harness.state.stopPc,
	)!.start.line;
}

function startAtBreakpoint(harness: DebuggerHarness, line: number): void {
	harness.state.breakpoints[SYSTEM_RESOURCE_DOMAIN + 1].set(
		DEBUG_SOURCE_PATH,
		new Set([line]),
	);
	rebuildRuntimeBreakpointPcs(harness.state);
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
	const runtime = {} as Runtime;
	const sources = {} as RuntimeSourceState;
	const first = createRuntimeDebuggerState(runtime, sources);
	const second = createRuntimeDebuggerState(runtime, sources);

	first.breakpoints[1].set('main.lua', new Set([2]));

	assert.deepEqual(first.breakpoints[1].get('main.lua'), new Set([2]));
	assert.deepEqual(second.breakpoints.map(breakpoints => breakpoints.size), [0, 0, 0]);
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
	assert.equal(stepOverHarness.state.stopInlineDepth, 1);
	assert.equal(
		resumeAndStop(stepOverHarness, RuntimeDebuggerResumeMode.StepOver),
		10,
	);
	assert.equal(stepOverHarness.state.stopInlineDepth, 1);

	const stepIntoHarness = createDebuggerHarness(source, 3);
	startAtBreakpoint(stepIntoHarness, 8);
	assert.equal(stoppedSourceLine(stepIntoHarness), 8);
	assert.equal(
		resumeAndStop(stepIntoHarness, RuntimeDebuggerResumeMode.StepInto),
		3,
	);
	assert.equal(stepIntoHarness.state.stopInlineDepth, 2);
	assert.equal(
		resumeAndStop(stepIntoHarness, RuntimeDebuggerResumeMode.StepOut),
		10,
	);
	assert.equal(stepIntoHarness.state.stopInlineDepth, 1);
});
