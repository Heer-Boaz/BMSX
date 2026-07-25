import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcceptedInterruptKind, BuiltinFunctionId, CPU, EMPTY_CALL_ARGS, Table, createBuiltinFunction, OpCode, RunResult, StringValue, type Closure, type Value } from '../../machine/ts/machine/cpu/cpu';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/machine/cpu/instruction_format';
import { BASE_CYCLES, encodeFixedCallArgCount } from '../../machine/ts/machine/cpu/opcode_info';
import {
	COP0_CAUSE,
	CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
	CPU_CAUSE_CODE_DATA_BUS_ERROR,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE,
	CPU_CAUSE_CODE_TRAP,
	CPU_CAUSE_NMI,
	CPU_STATUS_CART_ENTRY,
	CPU_STATUS_SYSTEM_ENTRY,
	LUA_FAULT_REASON_CALL_NON_FUNCTION,
} from '../../machine/ts/machine/cpu/cop0';
import {
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_UNMAPPED,
	IO_IRQ_ACK,
	IO_IRQ_MASK,
	IO_IRQ_FLAGS,
	IO_APU_TRANSFER_DATA,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IRQ_VBLANK,
} from '../../machine/ts/machine/bus/io';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { GX_GPU_GP0_VRAM_TO_CPU_FIRST } from '../../machine/ts/machine/devices/gx/gp0';
import { Machine } from '../../machine/ts/machine/machine';
import type { MicrotaskQueue } from '../../machine/ts/machine/scheduler/microtask_queue';
import { captureMachineSaveState, captureMachineState, restoreMachineSaveState, restoreMachineState } from '../../machine/ts/machine/save_state';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { MemoryAccessKind } from '../../machine/ts/machine/memory/access_kind';
import { CART_ROM_BASE, IO_WORD_SIZE, DYNAMIC_RAM_BASE } from '../../machine/ts/machine/memory/map';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import type { OptimizationLevel } from '../../machine/ts/lua/compiler/optimizer';
import { callClosureIntoWithScheduler } from '../../ide/runtime/closure_executor';
import { CpuExecutionState, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { FrameLoopState } from '../../machine/ts/machine/runtime/frame/loop';
import { FrameSchedulerState } from '../../machine/ts/machine/scheduler/frame';
import { Runtime, type FrameState } from '../../machine/ts/machine/runtime/runtime';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
	type TestBlua32Image,
} from '../helpers/blua32';
import { parseLuaChunk } from './cpu_test_harness';

function makeHaltTestImage(): TestBlua32Image {
	const code = new Uint8Array(7 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RFE, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 5, OpCode.CLOSURE, 0, 0, 0, 0);
	writeInstruction(code, 6, OpCode.RET, 0, 1, 0, 0);
	return linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 2 },
			{ firstWord: 2, wordCount: 1 },
			{ firstWord: 3, wordCount: 1 },
			{ firstWord: 4, wordCount: 3, maxStack: 1 },
		],
		functionIds: ['halt', 'idle', 'interrupt_return', 'return_halt'],
		startupFunctionIndex: 3,
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	});
}

const HALT_TEST_IMAGE = makeHaltTestImage();

function makeHaltCpu(): {
	memory: Memory;
	cpu: CPU;
	irqController: IrqController;
	haltClosure: Closure;
	haltFunctionAddress: number;
	idleFunctionAddress: number;
	interruptReturnFunctionAddress: number;
} {
	const { memory, cpu, irqController } = createTestSystemCpu(HALT_TEST_IMAGE);
	cpu.start(HALT_TEST_IMAGE.vectors.startupFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	return {
		memory,
		cpu,
		irqController,
		haltClosure: cpu.lastReturnValues[0] as Closure,
		haltFunctionAddress: HALT_TEST_IMAGE.symbols.functionAddresses[0],
		idleFunctionAddress: HALT_TEST_IMAGE.symbols.functionAddresses[1],
		interruptReturnFunctionAddress: HALT_TEST_IMAGE.symbols.functionAddresses[2],
	};
}

function makeNativeCallTestImage(): TestBlua32Image {
	const code = new Uint8Array(9 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.GETGL, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CALL, 0, encodeFixedCallArgCount(0), 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 5, OpCode.CLOSURE, 0, 0, 0, 0);
	writeInstruction(code, 6, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 7, OpCode.CLOSURE, 1, 0, 1, 0);
	writeInstruction(code, 8, OpCode.RET, 0, 2, 0, 0);
	return linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 3 },
			{ firstWord: 3, wordCount: 1 },
			{ firstWord: 4, wordCount: 5, maxStack: 2 },
		],
		globalNames: ['native_callback'],
		functionIds: ['call_native', 'idle', 'return_functions'],
		startupFunctionIndex: 2,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
}

const NATIVE_CALL_TEST_IMAGE = makeNativeCallTestImage();

function makeNativeCallCpu(nativeFunction: (cpu: CPU) => Value): {
	cpu: CPU;
	irqController: IrqController;
	callClosure: Closure;
	idleClosure: Closure;
} {
	const { cpu, irqController } = createTestSystemCpu(NATIVE_CALL_TEST_IMAGE);
	cpu.setGlobalByKey(
		StringValue.get(cpu.stringPool.intern('native_callback')),
		nativeFunction(cpu),
	);
	cpu.start(NATIVE_CALL_TEST_IMAGE.vectors.startupFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	return {
		cpu,
		irqController,
		callClosure: cpu.lastReturnValues[0] as Closure,
		idleClosure: cpu.lastReturnValues[1] as Closure,
	};
}

function makeRuntime(cpu: CPU, irqController: IrqController, sliceStats?: { begin: number; end: number }): Runtime {
	let cpuSliceActive = false;
	return {
		machine: {
			cpu,
			memory: cpu.memory,
			irqController,
			systemController: {
				cpuHeld: () => false,
				takeResetRequest: () => false,
			},
			gxGpu: { backendReadbackBlocksMachine: () => false },
				scheduler: {
					nowCycles: 0,
					hasDueTimer: () => false,
					nextDeadline: () => Number.MAX_SAFE_INTEGER,
					isCpuSliceActive: () => cpuSliceActive,
					beginCpuSlice: () => {
						cpuSliceActive = true;
						if (sliceStats) {
						sliceStats.begin += 1;
					}
				},
					endCpuSlice: () => {
						cpuSliceActive = false;
					if (sliceStats) {
						sliceStats.end += 1;
					}
				},
			},
			advanceDevices: () => {},
		},
		vblank: {
			tickCompleted: false,
		},
		callClosureInto: Runtime.prototype.callClosureInto,
	} as unknown as Runtime;
}

function makeFrameState(): FrameState {
	return {
		updateExecuted: false,
		luaFaulted: false,
		cycleBudgetRemaining: 100,
		cycleBudgetGranted: 100,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
	};
}

const INLINE_MICROTASKS: MicrotaskQueue = {
	queueMicrotask: task => task(),
	flush: () => {},
};

function makeMachine(
	memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }),
): Machine {
	const input = {
		getPlayerInput: () => ({
			checkActionTriggered: () => false,
			consumeAction: () => {},
			popContext: () => {},
			pushContext: () => {},
		}),
		beginFrame: () => {},
	};
	const machine = new Machine(memory, input as never);
	machine.initializeSystemIo();
	machine.resetDevices();
	return machine;
}

function makeHaltFrameRuntime(): Runtime {
	const { memory, cpu, irqController, haltFunctionAddress } = makeHaltCpu();
	cpu.start(haltFunctionAddress);
	const scheduler = {
		nowCycles: 0,
		hasDueTimer: () => false,
		nextDeadline: () => Number.MAX_SAFE_INTEGER,
		isCpuSliceActive: () => false,
		beginCpuSlice: () => {},
		endCpuSlice: () => {},
	};
	const runtime = {
		machine: {
			cpu,
			memory,
			irqController,
			systemController: {
				cpuHeld: () => false,
				takeResetRequest: () => false,
			},
			gxGpu: { backendReadbackBlocksMachine: () => false },
			scheduler,
			advanceDevices: (cycles: number) => {
				scheduler.nowCycles += cycles;
			},
		},
		vblank: {
			tickCompleted: false,
			beginTick: () => {},
			abandonTick: () => {},
			handleGpuRuntimeEdge: () => {},
		},
		frameScheduler: null as never,
		frameLoop: null as never,
		cpuExecution: null as never,
		timing: {
			cpuHz: 5_000,
			cpuCyclesPerMillisecond: 5,
			cycleBudgetPerFrame: 100,
			frameDurationMs: 20,
		},
		luaInitialized: true,
		luaRuntimeFailed: false,
		pendingCall: 'entry' as const,
	} as unknown as Runtime;
	runtime.frameLoop = new FrameLoopState(runtime);
	runtime.cpuExecution = new CpuExecutionState(runtime);
	runtime.frameScheduler = {
		lastTickSequence: 0,
		startScheduledFrame: () => {
			runtime.frameLoop.beginFrameState(runtime.timing.cycleBudgetPerFrame, 0);
			return true;
		},
		refillFrameBudget: () => true,
	} as never;
	return runtime;
}

function makeCompiledIrqRuntime(source: string): { cpu: CPU; irqController: IrqController; cpuExecution: CpuExecutionState; state: FrameState } {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'irq_vector.lua'), [], { entrySource: source });
	const finalized = linkTestSystemBlua32(compiled);
	const { cpu, memory, irqController } = createTestSystemCpu(finalized);
	cpu.start(finalized.vectors.startupFunctionAddress);
	const scheduler = {
		nowCycles: 0,
		hasDueTimer: () => false,
		nextDeadline: () => Number.MAX_SAFE_INTEGER,
		beginCpuSlice: () => {},
		endCpuSlice: () => {},
	};
	const runtime = {
		machine: {
			cpu,
			memory,
			irqController,
			systemController: { cpuHeld: () => false },
			gxGpu: { backendReadbackBlocksMachine: () => false },
			scheduler,
			advanceDevices: (cycles: number) => { scheduler.nowCycles += cycles; },
		},
		vblank: { tickCompleted: false, beginTick: () => {}, abandonTick: () => {}, handleGpuRuntimeEdge: () => {} },
	} as unknown as Runtime;
	return {
		cpu,
		irqController,
		cpuExecution: new CpuExecutionState(runtime),
		state: makeFrameState(),
	};
}

function makeCompiledCpu(source: string, optLevel: OptimizationLevel = 0): { cpu: CPU; irqController: IrqController; image: TestBlua32Image } {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'supervisor_vector.lua'), [], { entrySource: source, optLevel });
	const finalized = linkTestSystemBlua32(compiled);
	const { cpu, irqController } = createTestSystemCpu(finalized);
	cpu.start(finalized.vectors.startupFunctionAddress);
	return { cpu, irqController, image: finalized };
}

function runCompiledVblankIrq(source: string): { cpu: CPU; irqController: IrqController } {
	const { cpu, irqController, cpuExecution, state } = makeCompiledIrqRuntime(source);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpuExecution.runStoppedCpu(state), false);
	cpuExecution.runWithBudget(state);
	return { cpu, irqController };
}

function assertVblankIrqClear(memory: Memory, irqController: IrqController): void {
	assert.equal(irqController.hasAssertedMaskableInterruptLine(), false);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS), 0);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0);
}

function assertVblankIrqAsserted(memory: Memory, irqController: IrqController): void {
	assert.equal(irqController.hasAssertedMaskableInterruptLine(), true);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
}

function assertInterruptFrameActive(cpu: CPU, irqController: IrqController): void {
	assert.deepEqual(cpu.getCallStack().map(frame => frame.functionAddress), [
		HALT_TEST_IMAGE.symbols.functionAddresses[0],
		HALT_TEST_IMAGE.symbols.functionAddresses[2],
	]);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), false);
}

function returnFromInterruptFrame(runtime: Runtime, state: FrameState, cpu: CPU, irqController: IrqController): void {
	irqController.acknowledge(IRQ_VBLANK);
	runtime.cpuExecution.runWithBudget(state);
	assert.equal(cpu.getFrameDepth(), 0);
}

test('CPU protected-call microcode preempts, saves, resumes, and preserves Lua results', () => {
	const source = `
marker = {}
local succeed<const> = function()
	return 3, 4
end
local fail<const> = function()
	error(marker)
end
local handle<const> = function(value)
	return value
end
local handle_multiple<const> = function(value)
	return value, 99
end
local handle_failure<const> = function()
	error(marker)
end
success, success_a, success_b = pcall(succeed)
failure, handled = xpcall(fail, handle)
invalid_handler_success, invalid_handler_error = pcall(xpcall, succeed, nil)
multiple_failure, multiple_handled, multiple_extra = xpcall(fail, handle_multiple)
handler_failure, handler_failure_error = xpcall(fail, handle_failure)
nested_outer, nested_inner, nested_a, nested_b = pcall(pcall, succeed)
`;
	const { cpu } = makeCompiledCpu(source);
	cpu.setGlobalByKey(StringValue.get(cpu.stringPool.intern('error')), createBuiltinFunction(BuiltinFunctionId.Error));
	cpu.setGlobalByKey(StringValue.get(cpu.stringPool.intern('pcall')), createBuiltinFunction(BuiltinFunctionId.PCall));
	cpu.setGlobalByKey(StringValue.get(cpu.stringPool.intern('xpcall')), createBuiltinFunction(BuiltinFunctionId.XPCall));

	let restoredProtectedCall = false;
	while (cpu.getFrameDepth() > 0) {
		assert.equal(cpu.runUntilDepth(0, 1), cpu.getFrameDepth() === 0 ? RunResult.Halted : RunResult.Yielded);
		if (!restoredProtectedCall && cpu.getFrameDepth() > 0) {
			const state = cpu.captureRuntimeState();
			if (state.protectedCalls.length > 0) {
				cpu.restoreRuntimeState(state);
				restoredProtectedCall = true;
			}
		}
	}

	assert.equal(restoredProtectedCall, true);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('success'))), true);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('success_a'))), 3);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('success_b'))), 4);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('failure'))), false);
	assert.equal(
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('handled'))),
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('marker'))),
	);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('invalid_handler_success'))), false);
	assert.ok(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('invalid_handler_error'))) instanceof StringValue);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('multiple_failure'))), false);
	assert.equal(
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('multiple_handled'))),
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('marker'))),
	);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('multiple_extra'))), null);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('handler_failure'))), false);
	const handlerFailureError = cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('handler_failure_error')));
	assert.ok(handlerFailureError instanceof StringValue);
	assert.equal(cpu.stringPool.toString(handlerFailureError.id), 'error in error handling');
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('nested_outer'))), true);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('nested_inner'))), true);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('nested_a'))), 3);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('nested_b'))), 4);
	assert.deepEqual(cpu.captureRuntimeState().protectedCalls, []);
});

function callClosureInto(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	runtime.callClosureInto(fn, args, out);
}

test('CPU closure calls that execute HALT without a scheduled interrupt park without host exception', () => {
	for (const run of [callClosureInto, callClosureIntoWithScheduler]) {
		const { cpu, irqController, haltClosure, idleFunctionAddress } = makeHaltCpu();
		cpu.start(idleFunctionAddress);
		const runtime = makeRuntime(cpu, irqController);
		const out: Value[] = [];
		cpu.instructionBudgetRemaining = 73;

		run(runtime, haltClosure, EMPTY_CALL_ARGS, out);

		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(cpu.getFrameDepth(), 2);
		assert.deepEqual(out, []);
	}
});

test('host external closure calls wake from pending IRQ without vectoring', () => {
	const { cpu, irqController, haltClosure, idleFunctionAddress } = makeHaltCpu();
	cpu.start(idleFunctionAddress);
	const runtime = makeRuntime(cpu, irqController);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);

	const out: Value[] = [];
	callClosureInto(runtime, haltClosure, EMPTY_CALL_ARGS, out);

	assert.deepEqual(out, []);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal((runtime.machine.irqController.captureState().pendingFlags & IRQ_VBLANK) !== 0, true);
});

test('IRQ mask starts closed and gates pending maskable IRQs', () => {
	const { memory, cpu, irqController: irq, haltFunctionAddress } = makeHaltCpu();
	cpu.start(haltFunctionAddress);

	irq.raise(IRQ_VBLANK);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), false);

	memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), true);

	memory.writeValue(IO_IRQ_MASK, 0);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), false);
});

test('CPU closure calls continue after scheduler yield requests', () => {
	const nativeCost = 7;
	const { cpu, irqController, callClosure, idleClosure } = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'yielding_native',
		() => cpu.requestYield(),
		{ base: nativeCost, perArg: 0, perRet: 0 },
	));
	cpu.start(idleClosure.functionAddress);
	const spent = BASE_CYCLES[OpCode.GETGL] + BASE_CYCLES[OpCode.CALL] + nativeCost + BASE_CYCLES[OpCode.RET];
	const runtime = makeRuntime(cpu, irqController);
	const out: Value[] = [];

	cpu.instructionBudgetRemaining = 100;
	callClosureInto(runtime, callClosure, EMPTY_CALL_ARGS, out);

	assert.deepEqual(out, []);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU external closure calls that throw after executing preserve spent budget', () => {
	const nativeCost = 7;
	const { cpu, irqController, callClosure, idleClosure } = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'throwing_native',
		() => {
			throw new Error('native boom');
		},
		{ base: nativeCost, perArg: 0, perRet: 0 },
	));
	cpu.start(idleClosure.functionAddress);
	const spent = BASE_CYCLES[OpCode.GETGL] + BASE_CYCLES[OpCode.CALL] + nativeCost;
	const directRuntime = makeRuntime(cpu, irqController);
	const out: Value[] = [];

	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => callClosureInto(directRuntime, callClosure, EMPTY_CALL_ARGS, out),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.equal(cpu.getFrameDepth(), 1);

	const sliceStats = { begin: 0, end: 0 };
	const schedulerRuntime = makeRuntime(cpu, irqController, sliceStats);
	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => callClosureIntoWithScheduler(schedulerRuntime, callClosure, EMPTY_CALL_ARGS, out),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.deepEqual(sliceStats, { begin: 1, end: 1 });
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU frame executor rejects native Lua re-entry and closes the scheduler slice', () => {
	let runtime!: Runtime;
	let idleClosure!: Closure;
	const fixture = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'reentering_native',
		() => runtime.callClosureInto(idleClosure, EMPTY_CALL_ARGS, []),
		{ base: 7, perArg: 0, perRet: 0 },
	));
	const { cpu, irqController, callClosure } = fixture;
	idleClosure = fixture.idleClosure;
	cpu.start(callClosure.functionAddress);

	const sliceStats = { begin: 0, end: 0 };
	runtime = makeRuntime(cpu, irqController, sliceStats);
	const executor = new CpuExecutionState(runtime);
	assert.throws(
		() => executor.runWithBudget({
			updateExecuted: false,
			luaFaulted: false,
			cycleBudgetRemaining: 100,
			cycleBudgetGranted: 100,
			cycleCarryGranted: 0,
			activeCpuUsedCycles: 0,
		}),
		/External Lua closure execution requires a suspended CPU/,
	);
	assert.deepEqual(sliceStats, { begin: 1, end: 1 });
});

test('frame loop yields after HALT instead of continuing in the same host slice', () => {
	const runtime = makeHaltFrameRuntime();

	const progressed = runtime.frameLoop.tickUpdate();

	assert.equal(progressed, false);
	assert.equal(runtime.pendingCall, 'entry');
	assert.equal(runtime.machine.cpu.isHaltedUntilIrq(), true);
	assert.notEqual(runtime.frameLoop.currentFrameState, null);
});

test('HALT consumes an interrupt accepted before the wait instruction', () => {
	const runtime = makeHaltFrameRuntime();
	const cpu = runtime.machine.cpu;
	const irqController = runtime.machine.irqController;
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	irqController.raise(IRQ_VBLANK);

	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.captureRuntimeState().interruptEventPending, true);
	irqController.acknowledge(IRQ_VBLANK);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);

	assert.equal(cpu.getFrameDepth(), 0);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal(cpu.captureRuntimeState().interruptEventPending, false);
});

test('frame loop vectors a pending IRQ above a halted cart frame', () => {
	const runtime = makeHaltFrameRuntime();
	const cpu = runtime.machine.cpu;
	const irqController = runtime.machine.irqController;

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);

	irqController.raise(IRQ_VBLANK);
	const state = makeFrameState();
	const tickCompleted = runtime.cpuExecution.runStoppedCpu(state);

	assert.equal(tickCompleted, false);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal(cpu.getFrameDepth(), 2);
	assertInterruptFrameActive(cpu, irqController);

	returnFromInterruptFrame(runtime, state, cpu, irqController);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) === 0, true);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), true);
});

test('compiled IRQ vector dispatches through cart irq and acknowledges the device line', () => {
	const source = `
local irq_ack_addr<const> = 0x0800000c
local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
irq_seen = 0
function irq(flags)
	irq_seen = flags
	mem[irq_ack_addr] = flags
end
mem[irq_mask_addr] = irq_vblank
while true do
	halt_until_irq
end
`;
	const { cpu, irqController } = runCompiledVblankIrq(source);

	const irqSeen = cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('irq_seen')));
	assert.equal(irqSeen, IRQ_VBLANK);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) === 0, true);
});

test('IRQ closures preserve snapshots of captured locals at every optimization level', () => {
	const source = `
local irq_ack_addr<const> = 0x0800000c
local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
local sequence = 0
function irq(flags)
	sequence = sequence + 1
	mem[irq_ack_addr] = flags
end
mem[irq_mask_addr] = irq_vblank
local before<const> = sequence
halt_until_irq
observed_before = before
observed_sequence = sequence
`;
	for (const optLevel of [0, 1, 2, 3] as const) {
		const { cpu, irqController } = makeCompiledCpu(source, optLevel);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted, `O${optLevel} initial run`);
		irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.enterPendingInterrupt(), true, `O${optLevel} IRQ entry`);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted, `O${optLevel} resumed run`);
		assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('observed_before'))), 0, `O${optLevel} snapshot`);
		assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('observed_sequence'))), 1, `O${optLevel} live sequence`);
	}
});

test('linked system and cart handlers remain distinct across CPU save-state', () => {
	const systemSource = `
local irq_ack_addr<const> = 0x0800000c
local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
system_seen = 0
function irq(flags)
	system_seen = flags
	mem[irq_ack_addr] = flags
end
function exception() end
local wait_system<const> = function()
	mem[irq_mask_addr] = irq_vblank
	halt_until_irq
end
return wait_system
`;
	const cartSource = `
local irq_ack_addr<const> = 0x0800000c
local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
cart_seen = 0
function irq(flags)
	cart_seen = flags
	mem[irq_ack_addr] = flags
end
function exception() end
local wait_cart<const> = function()
	mem[irq_mask_addr] = irq_vblank
	halt_until_irq
end
return wait_cart
`;
	const system = compileLuaChunkToProgram(parseLuaChunk(systemSource, 'system.lua'), [], {
		entrySource: systemSource,
		programDomain: 'system',
	});
	const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'cart.lua'), [], {
		entrySource: cartSource,
		programDomain: 'cart',
	});
	const linked = linkTestBlua32Pair(system, cart);
	const memory = new Memory({ systemRom: linked.systemRomBytes, cartridgeSlots: cartridgeSlots(linked.cartRomBytes) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	cpu.mountExecutableMedia({
		system: linked.systemSymbols,
		cartridgeSlots: [linked.cartSymbols, null],
	});
	cpu.start(linked.systemVectors.startupFunctionAddress, EMPTY_CALL_ARGS, CPU_STATUS_SYSTEM_ENTRY);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const systemWaiter = cpu.lastReturnValues[0] as Closure;
	cpu.start(linked.cartVectors.startupFunctionAddress, EMPTY_CALL_ARGS, CPU_STATUS_CART_ENTRY);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const cartWaiter = cpu.lastReturnValues[0] as Closure;
	const saved = cpu.captureRuntimeState();
	assert.equal(saved.systemGlobals.some(entry => entry.name === 'irq'), true);
	assert.equal(saved.globals.some(entry => entry.name === 'irq'), true);
	cpu.restoreRuntimeState(saved);

	const runWaiter = (waiter: Closure, statusWord: number): void => {
		cpu.start(waiter.functionAddress, EMPTY_CALL_ARGS, statusWord);
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
		irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.enterPendingInterrupt(), true);
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	};

	runWaiter(systemWaiter, CPU_STATUS_SYSTEM_ENTRY);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('system_seen'))), IRQ_VBLANK);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('cart_seen'))), 0);
	runWaiter(cartWaiter, CPU_STATUS_CART_ENTRY);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('cart_seen'))), IRQ_VBLANK);
});

test('compiled IRQ vector storms on an unacknowledged level line', () => {
	const source = `
local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
irq_seen = 0
function irq(flags)
	irq_seen = irq_seen + 1
end
mem[irq_mask_addr] = irq_vblank
while true do
	halt_until_irq
end
`;
	const { cpu, irqController } = runCompiledVblankIrq(source);
	assert.equal((cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('irq_seen'))) as number) > 1, true);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) !== 0, true);
});

test('IRQ_MASK accepts pending IRQ at the next guest instruction boundary', () => {
	const source = `
local irq_ack_addr<const> = 0x0800000c
local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
irq_seen = 0
after_enable = 0
function irq(flags)
	irq_seen = irq_seen + flags
	mem[irq_ack_addr] = flags
end
mem[irq_mask_addr] = irq_vblank
after_enable = irq_seen
`;
	const { cpu, irqController, cpuExecution, state } = makeCompiledIrqRuntime(source);

	irqController.raise(IRQ_VBLANK);
	cpuExecution.runWithBudget(state);

	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('irq_seen'))), IRQ_VBLANK);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('after_enable'))), IRQ_VBLANK);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) === 0, true);
});

test('CPU save-state captured inside an interrupt frame restores and returns to the cart frame', () => {
	const runtime = makeHaltFrameRuntime();
	const cpu = runtime.machine.cpu;
	const irqController = runtime.machine.irqController;
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	irqController.raise(IRQ_VBLANK);
	const state = makeFrameState();
	runtime.cpuExecution.runStoppedCpu(state);
	assertInterruptFrameActive(cpu, irqController);

	const snapshot = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(snapshot);
	assertInterruptFrameActive(cpu, irqController);

	returnFromInterruptFrame(runtime, state, cpu, irqController);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), true);
});

test('manual NMI enters the exception root above a halted cart and RFE resumes at EPC', () => {
	const source = `
exception_cause = 0
exception_epc = 0
exception_status = 0
resumed = 0
function exception()
	exception_cause = cop0.cause
	exception_epc = cop0.epc
	exception_status = cop0.status
end
halt_until_irq
resumed = 1
`;
	const { cpu, irqController, image } = makeCompiledCpu(source);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);

	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	const activeState = cpu.captureRuntimeState();
	assert.equal(activeState.causeWord, CPU_CAUSE_NMI);
	assert.equal(activeState.statusWord, CPU_STATUS_CART_ENTRY << 2);
	assert.equal(activeState.frames.at(-1)!.functionAddress, image.vectors.exceptionFunctionAddress);
	assert.equal(activeState.frames.at(-1)!.isExceptionFrame, true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);

	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_cause'))), CPU_CAUSE_NMI);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_epc'))), activeState.epcWord);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_status'))), CPU_STATUS_CART_ENTRY << 2);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('resumed'))), 1);
	assert.equal(cpu.captureRuntimeState().statusWord, CPU_STATUS_CART_ENTRY);
});

test('BLua32 branches cannot enter adjacent function text', () => {
	const cases = [
		{ op: OpCode.JMP, initializeTrue: false },
		{ op: OpCode.JMPIF, initializeTrue: true },
		{ op: OpCode.JMPIFNOT, initializeTrue: false },
	] as const;

	for (const testCase of cases) {
		const branchWord = testCase.initializeTrue ? 1 : 0;
		const code = new Uint8Array((branchWord + 2) * INSTRUCTION_BYTES);
		if (testCase.initializeTrue) {
			writeInstruction(code, 0, OpCode.KTRUE, 0, 0, 0, 0);
		}
		writeInstruction(code, branchWord, testCase.op, 0, 0, 0, 0);
		writeInstruction(code, branchWord + 1, OpCode.RET, 0, 0, 0, 0);
		const image = linkRawTestSystemBlua32({
			text: code,
			functions: [
				{ firstWord: 0, wordCount: branchWord + 1 },
				{ firstWord: branchWord + 1, wordCount: 1 },
			],
			irqFunctionIndex: 1,
			exceptionFunctionIndex: 1,
		});
		const { cpu } = createTestSystemCpu(image);

		cpu.start(image.symbols.functionAddresses[0]);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.deepEqual(cpu.getCallStack().map(frame => frame.functionAddress), [
			image.symbols.functionAddresses[0],
		]);
	}
});

test('invalid CLOSURE targets hard-halt without entering host error handling', () => {
	const code = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.CLOSURE, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 1 }],
	});
	const { cpu } = createTestSystemCpu(image);

	cpu.start(image.symbols.functionAddresses[0]);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(cpu.getCallStack().map(frame => frame.functionAddress), [
		image.symbols.functionAddresses[0],
	]);
});

test('an uncaught Lua runtime error enters the exception root with CPU_CAUSE_CODE_TRAP instead of throwing to host', () => {
	const source = `
exception_cause = 0
exception_reason = 0
function exception()
	exception_cause = cop0.cause
	exception_reason = cop0.lua_fault_reason
	halt_until_irq
end
local nothing = nil
nothing()
`;
	const { cpu, image } = makeCompiledCpu(source);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(
		cpu.getCallStack().some(frame => frame.functionAddress === image.vectors.exceptionFunctionAddress),
		true,
	);
	assert.equal(
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_cause'))),
		CPU_CAUSE_CODE_TRAP,
	);
	assert.equal(
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_reason'))),
		LUA_FAULT_REASON_CALL_NON_FUNCTION,
	);
});

test('cross-image call-stack PCs belong to the frame image', () => {
	const modulePath = 'bios/test/cross_image_stack';
	const moduleSource = `
module<const>
local function leaf()
	halt_until_irq
end
local function caller()
	leaf()
end
return { caller = caller, leaf = leaf }
`;
	const module = {
		path: modulePath,
		chunk: parseLuaChunk(moduleSource, `${modulePath}.lua`),
		source: moduleSource,
	};
	const systemSource = 'return nil';
	const system = compileLuaChunkToProgram(
		parseLuaChunk(systemSource, 'system.lua'),
		[module],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = `
local cross_image_stack<const> = require("${modulePath}")
cross_image_stack.caller()
`;
	const cart = compileLuaChunkToProgram(
		parseLuaChunk(cartSource, 'cart.lua'),
		[],
		{ entrySource: cartSource, externalModules: [module], programDomain: 'cart' },
	);
	const linked = linkTestBlua32Pair(system, cart);
	const memory = new Memory({
		systemRom: linked.systemRomBytes,
		cartridgeSlots: cartridgeSlots(linked.cartRomBytes),
	});
	const cpu = new CPU(memory, new IrqController(memory));
	cpu.mountExecutableMedia({
		system: linked.systemSymbols,
		cartridgeSlots: [linked.cartSymbols, null],
	});

	cpu.start(linked.cartVectors.startupFunctionAddress, EMPTY_CALL_ARGS, CPU_STATUS_CART_ENTRY);
	assert.equal(cpu.runUntilDepth(0, 10_000), RunResult.Halted);
	const stack = cpu.getCallStack();
	assert.equal(stack.length >= 3, true);
	for (const frame of stack) {
		const image = frame.functionAddress >= CART_ROM_BASE ? linked.cartImage : linked.systemImage;
		assert.equal(frame.textAddress, image.header.textAddress);
		assert.equal(
			frame.pc >= image.header.textAddress
				&& frame.pc < image.header.textAddress + image.header.textByteCount,
			true,
		);
	}
});

test('RFE cannot resume outside the interrupted function record', () => {
	const { cpu, haltFunctionAddress, interruptReturnFunctionAddress } = makeHaltCpu();
	cpu.start(haltFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted);
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);

	const state = cpu.captureRuntimeState();
	state.epcWord = HALT_TEST_IMAGE.image.functions[1].codeAddress;
	cpu.restoreRuntimeState(state);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(cpu.getCallStack().map(frame => frame.functionAddress), [
		haltFunctionAddress,
		interruptReturnFunctionAddress,
	]);
});

test('system NMI preempts a stalled cart IRQ root and RFE retries its unaccepted mapped store', () => {
	const source = `
local irq_ack_addr<const> = ${IO_IRQ_ACK}
local irq_mask_addr<const> = ${IO_IRQ_MASK}
local irq_vblank<const> = ${IRQ_VBLANK}
local data_port<const>: *word = ${IO_APU_TRANSFER_DATA}
exception_count = 0
store_complete = 0
cart_resumed = 0
function irq(flags)
	*data_port = 0x12345678
	store_complete = store_complete + 1
	mem[irq_ack_addr] = flags
end
function exception()
	exception_count = exception_count + 1
end
mem[irq_mask_addr] = irq_vblank
halt_until_irq
cart_resumed = 1
`;
	const { cpu, irqController } = makeCompiledCpu(source);
	const port = { ready: false, writes: 0 };
	cpu.memory.mapIoWrite(IO_APU_TRANSFER_DATA, port, context => {
		context.writes += 1;
	});
	cpu.memory.mapIoWriteReady(IO_APU_TRANSFER_DATA, context => context.ready);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isMemoryWriteBlocked(), true);
	assert.equal(port.writes, 0);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('store_complete'))), 0);

	cpu.abortStalledMemoryWrite();
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.NonMaskable);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_count'))), 1);
	assert.equal(cpu.isMemoryWriteBlocked(), true);
	assert.equal(port.writes, 0);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('store_complete'))), 0);

	port.ready = true;
	cpu.resumeMemoryWrite(IO_APU_TRANSFER_DATA);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(port.writes, 1);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('store_complete'))), 1);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('cart_resumed'))), 1);
});

test('user CP0 access vectors synchronously and a supervisor EPC write selects the resume instruction', () => {
	const source = `
fault_cause = 0
continued = 0
function exception()
	fault_cause = cop0.cause
	cop0.epc = cop0.epc + 4
end
fault_value = cop0.status
continued = 1
`;
	for (const optLevel of [0, 3] as const) {
		const { cpu } = makeCompiledCpu(source, optLevel);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);

		assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('fault_cause'))), CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('continued'))), 1);
		assert.equal(cpu.captureRuntimeState().statusWord, CPU_STATUS_CART_ENTRY);
	}
});

test('CPU mapped bus errors enter the system exception vector without committing a faulting tail', () => {
	const unmappedAddress = 0x06000000;
	const code = new Uint8Array(14 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(code, 2, OpCode.LOAD_MEM_D, 1, 0, MemoryAccessKind.Word, 0);
	writeInstruction(code, 3, OpCode.RET, 1, 1, 0, 0);
	writeInstruction(code, 4, OpCode.MFC0, 0, COP0_CAUSE, 0, 0);
	writeInstruction(code, 5, OpCode.RFE, 0, 0, 0, 0);
	writeInstruction(code, 6, OpCode.LOADK, 0, 0, 1, 0);
	writeInstruction(code, 7, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(code, 8, OpCode.K1, 2, 0, 0, 0);
	writeInstruction(code, 9, OpCode.K1, 3, 0, 0, 0);
	writeInstruction(code, 10, OpCode.K1, 4, 0, 0, 0);
	writeInstruction(code, 11, OpCode.K1, 5, 0, 0, 0);
	writeInstruction(code, 12, OpCode.STORE_MEM_WORDS_D, 1, 0, 5, 0);
	writeInstruction(code, 13, OpCode.RET, 0, 0, 0, 0);

	const image = linkRawTestSystemBlua32({
		text: code,
		constants: [unmappedAddress, IO_SYS_BUS_FAULT_CODE - IO_WORD_SIZE],
		functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 2 },
			{ firstWord: 4, wordCount: 2 },
			{ firstWord: 6, wordCount: 8, maxStack: 6 },
		],
		functionIds: ['user_bus_load', 'system_exception', 'system_bus_burst'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const { memory, cpu } = createTestSystemCpu(image);
	const userBusLoadAddress = image.symbols.functionAddresses[0];
	const systemExceptionAddress = image.symbols.functionAddresses[1];
	const systemBusBurstAddress = image.symbols.functionAddresses[2];

	cpu.start(userBusLoadAddress);
	assert.equal(cpu.runUntilDepth(0, 4), RunResult.Yielded);
	const loadFault = cpu.captureRuntimeState();
	assert.equal(loadFault.causeWord, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	assert.equal(loadFault.epcWord, image.image.header.textAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(loadFault.badAddressWord, 0);
	assert.equal(loadFault.frames.at(-1)!.functionAddress, systemExceptionAddress);
	assert.equal(cpu.readFrameRegister(0, 1), 1);
	loadFault.epcWord += INSTRUCTION_BYTES;
	cpu.restoreRuntimeState(loadFault);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(cpu.lastReturnValues, [1]);

	memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
	memory.readMappedU8(unmappedAddress);
	cpu.start(systemBusBurstAddress, EMPTY_CALL_ARGS, CPU_STATUS_SYSTEM_ENTRY);
	assert.equal(cpu.runUntilDepth(0, 10), RunResult.Yielded);
	const burstFault = cpu.captureRuntimeState();
	assert.equal(burstFault.causeWord, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	assert.equal(burstFault.epcWord, image.image.header.textAddress + 12 * INSTRUCTION_BYTES);
	assert.equal(burstFault.statusWord, CPU_STATUS_SYSTEM_ENTRY << 2);
	assert.equal(burstFault.frames.at(-1)!.functionAddress, systemExceptionAddress);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE - IO_WORD_SIZE), 1);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), unmappedAddress);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
});

test('CPU mapped memory accepts byte addresses and four-byte-aligned f64 addresses', () => {
	const byteAddress = DYNAMIC_RAM_BASE + 0x101;
	const f64Address = DYNAMIC_RAM_BASE + 0x104;
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.LOAD_MEM, 1, 0, MemoryAccessKind.U8, 0);
	writeInstruction(code, 2, OpCode.LOADK, 0, 0, 1, 0);
	writeInstruction(code, 3, OpCode.LOAD_MEM, 2, 0, MemoryAccessKind.F64LE, 0);
	writeInstruction(code, 4, OpCode.RET, 1, 2, 0, 0);
	writeInstruction(code, 5, OpCode.HALT, 0, 0, 0, 0);

	const image = linkRawTestSystemBlua32({
		text: code,
		constants: [byteAddress, f64Address],
		functions: [
			{ firstWord: 0, wordCount: 5, maxStack: 3 },
			{ firstWord: 5, wordCount: 1 },
		],
		functionIds: ['mapped_memory', 'interrupt_halt'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const { memory, cpu } = createTestSystemCpu(image);
	memory.writeMappedU8(byteAddress, 0x5a);
	memory.writeMappedF64LE(f64Address, Math.PI);

	cpu.start(image.vectors.startupFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(cpu.lastReturnValues, [0x5a, Math.PI]);
});

test('CPU address errors vector before any mapped-memory bus cycle or destination commit', () => {
	const alignedAddress = DYNAMIC_RAM_BASE + 0x100;
	const faultAddress = alignedAddress + 1;
	const cases = [
		{ name: 'LOAD_MEM_D u16', op: OpCode.LOAD_MEM_D, operandC: MemoryAccessKind.U16LE, valueCount: 1, cause: CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD },
		{ name: 'LOAD_MEM f64', op: OpCode.LOAD_MEM, operandC: MemoryAccessKind.F64LE, valueCount: 1, cause: CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD },
		{ name: 'STORE_MEM_D u32', op: OpCode.STORE_MEM_D, operandC: MemoryAccessKind.U32LE, valueCount: 1, cause: CPU_CAUSE_CODE_ADDRESS_ERROR_STORE },
		{ name: 'STORE_MEM f64', op: OpCode.STORE_MEM, operandC: MemoryAccessKind.F64LE, valueCount: 1, cause: CPU_CAUSE_CODE_ADDRESS_ERROR_STORE },
		{ name: 'STORE_MEM_WORDS_D', op: OpCode.STORE_MEM_WORDS_D, operandC: 2, valueCount: 2, cause: CPU_CAUSE_CODE_ADDRESS_ERROR_STORE },
		{ name: 'STORE_MEM_WORDS', op: OpCode.STORE_MEM_WORDS, operandC: 2, valueCount: 2, cause: CPU_CAUSE_CODE_ADDRESS_ERROR_STORE },
	] as const;

	for (const testCase of cases) {
		const memoryInstruction = 2 + testCase.valueCount;
		const instructionCount = memoryInstruction + 2;
		const code = new Uint8Array(instructionCount * INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
		writeInstruction(code, 1, OpCode.LOADK, 0, 0, 0, 0);
		for (let value = 0; value < testCase.valueCount; value += 1) {
			writeInstruction(code, 2 + value, OpCode.K1, 1 + value, 0, 0, 0);
		}
		writeInstruction(code, memoryInstruction, testCase.op, 1, 0, testCase.operandC, 0);
		writeInstruction(code, memoryInstruction + 1, OpCode.RET, 0, 0, 0, 0);

		const image = linkRawTestSystemBlua32({
			text: code,
			constants: [faultAddress],
			functions: [
				{ firstWord: 0, wordCount: 1 },
				{ firstWord: 1, wordCount: instructionCount - 1, maxStack: testCase.valueCount + 1 },
			],
			functionIds: ['system_exception', `address_error/${testCase.name}`],
			startupFunctionIndex: 1,
			irqFunctionIndex: 0,
			exceptionFunctionIndex: 0,
		});
		const { memory, cpu } = createTestSystemCpu(image);
		memory.writeMappedU32LE(alignedAddress, 0x11223344);
		memory.writeMappedU32LE(alignedAddress + 4, 0x55667788);
		memory.writeMappedU32LE(alignedAddress + 8, 0x99aabbcc);
		const faultSequence = memory.readBusFaultSequence();

		cpu.start(image.vectors.startupFunctionAddress);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted, testCase.name);
		const state = cpu.captureRuntimeState();
		assert.equal(state.causeWord, testCase.cause, testCase.name);
		assert.equal(state.epcWord, image.image.header.textAddress + memoryInstruction * INSTRUCTION_BYTES, testCase.name);
		assert.equal(state.badAddressWord, faultAddress, testCase.name);
		assert.equal(state.frames.at(-1)!.functionAddress, image.symbols.functionAddresses[0], testCase.name);
		assert.equal(memory.readBusFaultSequence(), faultSequence, testCase.name);
		assert.equal(cpu.readFrameRegister(0, 1), 1, testCase.name);
		assert.deepEqual([
			memory.readMappedU32LE(alignedAddress),
			memory.readMappedU32LE(alignedAddress + 4),
			memory.readMappedU32LE(alignedAddress + 8),
		], [0x11223344, 0x55667788, 0x99aabbcc], testCase.name);
	}
});

test('CPU runtime snapshot preserves nested table object identities', () => {
	const { cpu } = makeHaltCpu();
	const rootName = StringValue.get(cpu.stringPool.intern('root'));
	const childKey = StringValue.get(cpu.stringPool.intern('child'));
	const parentKey = StringValue.get(cpu.stringPool.intern('parent'));
	const objectKeyName = StringValue.get(cpu.stringPool.intern('object_key'));
	const root = cpu.createTable(0, 64);
	const child = cpu.createTable(0, 1);
	const objectKey = cpu.createTable(0, 0);
	child.setStringKey(parentKey, root);
	root.setStringKey(childKey, child);
	root.setStringKey(objectKeyName, objectKey);
	root.set(objectKey, child);
	cpu.setGlobalByKey(rootName, root);
	const snapshot = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(snapshot);

	const restoredRoot = cpu.getGlobalByKey(rootName) as Table;
	const restoredChild = restoredRoot.getStringKey(childKey) as Table;
	const restoredObjectKey = restoredRoot.getStringKey(objectKeyName) as Table;
	assert.notEqual(restoredChild, restoredRoot);
	assert.equal(restoredChild.getStringKey(parentKey), restoredRoot);
	assert.equal(restoredRoot.get(restoredObjectKey), restoredChild);
});


test('frame scheduler does not burn active CPU budget while halted for IRQ without host time', () => {
	const runtime = makeHaltFrameRuntime();
	runtime.frameScheduler = new FrameSchedulerState(runtime);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.machine.cpu.isHaltedUntilIrq(), true);
	const frameState = runtime.frameLoop.currentFrameState!;
	const remaining = frameState.cycleBudgetRemaining;

	runtime.frameScheduler.run(0);

	assert.equal(frameState.cycleBudgetRemaining, remaining);
	assert.equal(runtime.machine.cpu.isHaltedUntilIrq(), true);
});

test('frame scheduler discards host time spent waiting for GPU backend execution', () => {
	const runtime = makeHaltFrameRuntime();
	let backendBlocked = true;
	(runtime.machine.gxGpu as unknown as { backendReadbackBlocksMachine(): boolean }).backendReadbackBlocksMachine = () => backendBlocked;
	runtime.frameScheduler = new FrameSchedulerState(runtime);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.frameLoop.currentFrameState, null);

	backendBlocked = false;
	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.frameLoop.currentFrameState, null);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.notEqual(runtime.frameLoop.currentFrameState, null);
});

test('CPU execution stops at the device deadline that activates GPUREAD', () => {
	const machine = makeMachine();
	const cpu = machine.cpu;
	const instructionCount = 64;
	const code = new Uint8Array((instructionCount + 1) * INSTRUCTION_BYTES);
	for (let instruction = 0; instruction < instructionCount; instruction += 1) {
		writeInstruction(code, instruction, OpCode.LOADNIL, 0, 0, 0, 0);
	}
	writeInstruction(code, instructionCount, OpCode.RET, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: instructionCount + 1 }],
		functionIds: ['gpu_read_deadline'],
	});
	machine.memory.installSystemRom(image.romBytes);
	cpu.mountExecutableMedia({ system: image.symbols, cartridgeSlots: [null, null] });
	cpu.start(image.vectors.startupFunctionAddress);
	machine.gxGpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	machine.gxGpu.writeGp0(0);
	machine.gxGpu.writeGp0((1 << 16) | 1);
	const runtime = {
		machine,
		vblank: {
			tickCompleted: false,
			handleGpuRuntimeEdge: () => {},
		},
		applyPublishedGxGpuPcrtcTiming: () => {},
	} as unknown as Runtime;
	runDueRuntimeTimers(runtime);
	const readbackDeadline = machine.scheduler.nextDeadline();
	const state = makeFrameState();
	state.cycleBudgetRemaining = 100;
	state.cycleBudgetGranted = 100;

	new CpuExecutionState(runtime).runWithBudget(state);

	assert.equal(machine.gxGpu.backendReadbackPending(), true);
	assert.equal(machine.scheduler.nowCycles, readbackDeadline);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(state.cycleBudgetRemaining > 0, true);
});

test('IRQ state restore preserves asserted line and cart-visible flags', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const irq = new IrqController(memory);

	memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	irq.raise(IRQ_VBLANK);
	const state = irq.captureState();
	irq.reset();

	assertVblankIrqClear(memory, irq);

	irq.restoreState(state);

	assertVblankIrqAsserted(memory, irq);
});

test('Machine full-state restore preserves asserted IRQ line and cart-visible flags', () => {
	const machine = makeMachine();

	machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	machine.irqController.raise(IRQ_VBLANK);
	const state = captureMachineState(machine);
	machine.irqController.reset();

	assertVblankIrqClear(machine.memory, machine.irqController);

	restoreMachineState(machine, state);

	assertVblankIrqAsserted(machine.memory, machine.irqController);
});

test('Machine save-state restore preserves asserted IRQ line and cart-visible flags', () => {
	const machine = makeMachine();

	machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	machine.irqController.raise(IRQ_VBLANK);
	const state = captureMachineSaveState(machine);
	machine.irqController.reset();

	assertVblankIrqClear(machine.memory, machine.irqController);

	restoreMachineSaveState(machine, state);

	assertVblankIrqAsserted(machine.memory, machine.irqController);
});
