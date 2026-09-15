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
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { RuntimeGuestCallPlan, scheduleRuntimeGuestCall } from '../../ide/runtime/guest_call';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
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
		() => current ? { domain: -1, closure: values[0] as Closure, args: () => [] } : undefined,
		() => assert.fail('cancelled evaluation started'), completed => { assert.equal(completed, false); cancelled = true; }, assert.fail);
	current = false; readback.resolve(); await pending;
	assert.equal(cancelled, true); assert.equal(state.plans.controlActive, false);
	assert.equal(cpu.getFrameDepth(), depth);
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
	pushRuntimeDebuggerControlPlan(state, new RuntimeGuestCallPlan(runtime, depth, value => { completed = value; }), 'workbench');
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
