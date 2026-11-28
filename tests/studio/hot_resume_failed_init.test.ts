import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { Input } from '../../hosts/common/input/manager';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { createRuntimeDebuggerState, didExecuteRuntimeDebuggerPlan, willExecuteRuntimeDebuggerPlan } from '../../ide/runtime/debugger_state';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { admitHotResume, type HotResumeEvent } from '../../ide/runtime/hot_resume';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { isOpen, load as readCapture } from '../../machine/ts/machine/cpu/upvalue';
import { valueInteger, valueNil, valueThread } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { advanceRuntimeTime } from '../../machine/ts/machine/runtime/cpu_executor';
import { CPU_CAUSE_CODE_SYSCALL } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import {
	IO_SYS_CONTROL, IO_SYS_STATUS, IO_SYS_SUPERVISOR_FAULT_SEQUENCE, SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH,
	SYS_CONTROL_SUPERVISOR_LEAVE, SYS_STATUS_SUPERVISOR_EXIT_REQUESTED, SYS_STATUS_SUPERVISOR_RESUMABLE,
} from '../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { linkCartBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../helpers/managed_system';
import { createLoadedTestRuntimeSourceState, createTestRomToolingLayer } from '../helpers/runtime_sources';

test('Hot Resume unwinds a failed initializer’s captured frames in the installed firmware', async () => {
	const system = linkManagedTestSystem(`
local bridge<const> = require('kernel/exception_bridge')
local scopes<const> = require('debug/frame_scopes')
local ready<const>: *word = bridge.monitor_ready
*ready = 1
function exception()
 local entry<const>: *monitor_entry_state = bridge.monitor_entry
 local pc<const>, status<const> = entry.epc, entry.status
 local thread<const> = __bmsx_coroutine_running()
 local completion = __bmsx_frame_count(thread) - 1
 while true do
  local _<const>, _<const>, _<const>, injected<const> = __bmsx_frame_header(thread, completion)
  if injected then break end
  completion = completion - 1
 end
 kept_scope = scopes.open(thread, completion - 1)
 removed_scope = scopes.open(thread, completion)
 mem[${IO_SYS_CONTROL}] = ${SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH}
 while (mem[${IO_SYS_STATUS}] & ${SYS_STATUS_SUPERVISOR_EXIT_REQUESTED}) == 0 do end
 cop0.epc, cop0.status = pc, status
 mem[${IO_SYS_CONTROL}] = ${SYS_CONTROL_SUPERVISOR_LEAVE}
end
` + TEST_CART_TRANSFER_SOURCE, 3, [{ path: 'debug/frame_scopes', source: readFileSync('machine/bios/debug/frame_scopes.lua', 'utf8') }]);
	const source = `module<entry>
fail_once = true
fail_callable = false
retained_capture = false
init_succeeded = 0
local function fail_initializer()
 local captured = 17
 retained_capture = function() return captured end
 captured = 42
 fail_callable(71)
end
local function initialize<init>()
 if fail_once then
  fail_once = false
  fail_initializer()
 end
 init_succeeded = init_succeeded + 1
end
while true do halt_until_irq end
`;
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'entry.lua'), [], { entrySource: source, optLevel: 3 });
	const cart = linkCartBlua32Image(system.biosImports, encodeCompiledProgramObject(program), program.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const systemRom = writeTestBlua32Rom(system, system.diagnosticSources), cartRom = writeTestBlua32Rom(cart);
	let requestLine = false;
	const runtime = new Runtime({ systemRomBytes: systemRom, cartridgeSlots: cartridgeSlots(cartRom), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => requestLine, applyInputControllerVibrationEffect() {},
	});
	const input = { supervisorRequestLineHigh: () => requestLine, setProgrammaticSupervisorRequestLine: (high: boolean) => { requestLine = high; } } as Input;
	const sources = createLoadedTestRuntimeSourceState(createTestRomToolingLayer('system', 'fixture-system', systemRom),
		[createTestRomToolingLayer('cart', 'fixture-cart', cartRom), null]);
	const debuggerState = createRuntimeDebuggerState(runtime, sources), fault = createRuntimeFaultState();
	const guest = new SuspendedGuestSession(runtime);
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { finishGxGpuReadbacks: async () => {} } } as VideoPresenter);
	const { cpu, memory, inputController, scheduler } = runtime.machine;
	runtime.boot();
	const step = (grant = 20_000) => {
		if (debuggerState.plans.controlActive) willExecuteRuntimeDebuggerPlan(debuggerState);
		inputController.onVblankEdge(scheduler.nowCycles);
		const result = cpu.runUntilDepth(0, grant);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		advanceRuntimeTime(runtime, grant - cpu.instructionBudgetRemaining);
		if (debuggerState.plans.controlActive) didExecuteRuntimeDebuggerPlan(debuggerState);
		return result;
	};
	for (let i = 0; i < 180 && cpu.activeCartridgeSlot() !== 0; ++i) step();
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.equal(step(), RunResult.Halted);
	const callerDepth = cpu.getFrameDepth(), callerPc = cpu.readFramePc(callerDepth - 1);
	const initializer = cart.layout.header.initFunctionAddress;
	assert.notEqual(initializer, 0);
	const outcomes: string[] = [];
	cpu.beginCompletionCallInExecutionDomain(0, initializer);
	debuggerState.plans.pushCompletionBatch(cpu.activeThread.address, callerDepth, [0], result => outcomes.push(result.status));
	for (let i = 0; i < 180 && (memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 0
		|| (memory.readMappedU32LE(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_RESUMABLE) === 0); ++i) step();
	assert.equal(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 1);
	assert.ok((memory.readMappedU32LE(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_RESUMABLE) !== 0);
	debuggerState.plans.faultCompletionBatches(1);
	assert.deepEqual(outcomes, ['faulted']);
	const retained = asClosure(guest.global('retained_capture'), nativeHeapReference(cpu).gc);
	const cell = ClosureRecord.captureAddress(memory, retained, 0);
	assert.equal(isOpen(memory, cell), true);
	assert.equal(readCapture(memory, cell), valueInteger(42));
	const thread = valueThread(cpu.activeThread.address);
	const keptScope = guest.global('kept_scope'), removedScope = guest.global('removed_scope');
	assert.equal(guest.readStringMember(keptScope, 'thread'), thread);
	assert.equal(guest.readStringMember(removedScope, 'thread'), thread);
	const events: HotResumeEvent[] = [];
	const unwind = system.layout.functions[system.symbols.metadata.functionIds.indexOf('module:kernel/frame_unwind/module')];
	const unwindIssued = () => {
		const pc = cpu.readEpcWord() - INSTRUCTION_BYTES;
		return cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_SYSCALL
			&& pc >= unwind.codeAddress && pc < unwind.codeAddress + unwind.codeByteCount;
	};
	let enteredUnwind = false;
	assert.equal(admitHotResume(sources, guest, fault, debuggerState, input, tasks, runtime, null, () => true,
		event => events.push(event)), 'deferred');
	for (let i = 0; i < 180 && !events.some(event => event.kind === 'initializing'); ++i) {
		if (cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1) === unwind.address) {
			assert.equal(isOpen(memory, cell), true, 'the host has not retired the failed frames');
			assert.equal(guest.readStringMember(removedScope, 'thread'), thread, 'admitting the unwind has not changed its scope');
			for (let instruction = 0; instruction < 2048 && !unwindIssued(); ++instruction) step(1);
			assert.ok(unwindIssued(), 'only the ordinary unwind body can issue this frame transfer');
			assert.equal(guest.readStringMember(removedScope, 'thread'), valueNil(), 'guest scope retirement precedes its frame transfer');
			assert.equal(guest.readStringMember(keptScope, 'thread'), thread, 'a scope below the unwind boundary remains live');
			assert.equal(isOpen(memory, cell), true, 'the fixed guest code has not closed it yet');
			enteredUnwind = true;
		}
		step(); await tasks.join();
	}
	assert.equal(enteredUnwind, true);
	assert.deepEqual(events.map(event => event.kind), ['applied', 'initializing'], JSON.stringify(events));
	assert.equal(cpu.readFramePc(callerDepth - 1), callerPc);
	assert.equal(isOpen(memory, cell), false);
	assert.equal(readCapture(memory, cell), valueInteger(42));
	for (let i = 0; i < 180 && !events.some(event => event.kind === 'completed'); ++i) {
		step(); debuggerState.plans.pruneCompletedCompletionBatches();
	}
	assert.equal(guest.global('init_succeeded'), valueInteger(1));
	assert.deepEqual(events.map(event => event.kind), ['applied', 'initializing', 'completed']);
});
