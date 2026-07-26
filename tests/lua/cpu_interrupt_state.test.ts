import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcceptedInterruptKind, CPU, OpCode, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { Table } from '../../machine/ts/machine/cpu/table';
import { BuiltinFunctionId, EMPTY_CALL_ARGS, createBuiltinFunction, StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import {
	INSTRUCTION_BYTES,
	writeInstruction,
} from '../../machine/ts/machine/cpu/instruction_format';
import { BASE_CYCLES, encodeFixedCallArgCount } from '../../machine/ts/machine/cpu/opcode_info';
import {
	COP0_CAUSE,
	COP0_EXEC,
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
import {
	BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET,
	type Blua32ImageLayout,
} from '../../machine/ts/machine/cpu/blua32_image';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import type { OptimizationLevel } from '../../machine/ts/lua/compiler/optimizer';
import {
	applyHotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
} from '../../ide/runtime/hot_resume_relocation';
import { CpuExecutionState, runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { FrameLoopState } from '../../machine/ts/machine/runtime/frame/loop';
import { FrameSchedulerState } from '../../machine/ts/machine/scheduler/frame';
import { Runtime, type FrameState } from '../../machine/ts/machine/runtime/runtime';
import {
	createTestBlua32PairCpu,
	createTestSystemCpu,
	linkRawTestBlua32Pair,
	linkRawTestSystemBlua32,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
	type TestBlua32Image,
	type TestBlua32ImagePair,
	type TestBlua32Source,
} from '../helpers/blua32';
import { parseLuaChunk } from './cpu_test_harness';

const CART_LAUNCHER_SYSTEM_CODE = new Uint8Array(4 * INSTRUCTION_BYTES);
writeInstruction(CART_LAUNCHER_SYSTEM_CODE, 0, OpCode.LOADK, 0, 0, 0, 0);
writeInstruction(CART_LAUNCHER_SYSTEM_CODE, 1, OpCode.LOAD_MEM, 0, 0, MemoryAccessKind.U32LE, 0);
writeInstruction(CART_LAUNCHER_SYSTEM_CODE, 2, OpCode.MTC0, 0, COP0_EXEC, 0, 0);
writeInstruction(CART_LAUNCHER_SYSTEM_CODE, 3, OpCode.RFE, 0, 0, 0, 0);
const CART_LAUNCHER_SYSTEM_IMAGE_SOURCE: TestBlua32Source = {
	text: CART_LAUNCHER_SYSTEM_CODE,
	functions: [
		{ firstWord: 0, wordCount: 3 },
		{ firstWord: 3, wordCount: 1 },
	],
	constants: [CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET],
	startupFunctionIndex: 0,
	irqFunctionIndex: 1,
	exceptionFunctionIndex: 1,
};

function makeHaltTestImages(startupFunctionIndex: number): TestBlua32ImagePair {
	const code = new Uint8Array(7 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RFE, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 5, OpCode.CLOSURE, 0, 0, 0, 0);
	writeInstruction(code, 6, OpCode.RET, 0, 1, 0, 0);
	return linkRawTestBlua32Pair(
		CART_LAUNCHER_SYSTEM_IMAGE_SOURCE,
		{
			text: code,
			functions: [
				{ firstWord: 0, wordCount: 2 },
				{ firstWord: 2, wordCount: 1 },
				{ firstWord: 3, wordCount: 1 },
				{ firstWord: 4, wordCount: 3, maxStack: 1 },
			],
			functionIds: ['halt', 'idle', 'interrupt_return', 'return_halt'],
			startupFunctionIndex,
			irqFunctionIndex: 2,
			exceptionFunctionIndex: 2,
		},
	);
}

const HALT_TEST_IMAGES = makeHaltTestImages(0);
const HALT_CLOSURE_TEST_IMAGES = makeHaltTestImages(3);

function identityHotResumeRevision(image: Blua32ImageLayout): HotResumeRevision {
	const functionAddresses = new Uint32Array(image.functions.length);
	for (let index = 0; index < image.functions.length; index += 1) {
		functionAddresses[index] = image.functions[index].address;
	}
	const pcAddresses = new Int32Array(image.header.textByteCount / INSTRUCTION_BYTES);
	for (let index = 0; index < pcAddresses.length; index += 1) {
		pcAddresses[index] = image.header.textAddress + index * INSTRUCTION_BYTES;
	}
	return {
		previousImage: image,
		freshImage: image,
		revision: { functionAddresses, pcAddresses },
	};
}

function makeHaltCpu(): {
	memory: Memory;
	cpu: CPU;
	irqController: IrqController;
	haltFunctionAddress: number;
	cartIrqFunctionAddress: number;
	systemExceptionFunctionAddress: number;
} {
	const { memory, cpu, irqController } = createTestBlua32PairCpu(HALT_TEST_IMAGES);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	return {
		memory,
		cpu,
		irqController,
		haltFunctionAddress: HALT_TEST_IMAGES.cartSymbols.functionAddresses[0],
		cartIrqFunctionAddress: HALT_TEST_IMAGES.cartSymbols.functionAddresses[2],
		systemExceptionFunctionAddress: HALT_TEST_IMAGES.systemSymbols.functionAddresses[1],
	};
}

function makeNativeCallTestImages(startupFunctionIndex: number): TestBlua32ImagePair {
	const code = new Uint8Array(9 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.GETGL, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CALL, 0, encodeFixedCallArgCount(0), 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RFE, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 5, OpCode.CLOSURE, 0, 0, 0, 0);
	writeInstruction(code, 6, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 7, OpCode.CLOSURE, 1, 0, 1, 0);
	writeInstruction(code, 8, OpCode.RET, 0, 2, 0, 0);
	return linkRawTestBlua32Pair(
		CART_LAUNCHER_SYSTEM_IMAGE_SOURCE,
		{
			text: code,
			functions: [
				{ firstWord: 0, wordCount: 3 },
				{ firstWord: 3, wordCount: 1 },
				{ firstWord: 4, wordCount: 5, maxStack: 2 },
			],
			globalNames: ['native_callback'],
			functionIds: ['call_native', 'idle', 'return_functions'],
			startupFunctionIndex,
			irqFunctionIndex: 1,
			exceptionFunctionIndex: 1,
		},
	);
}

const NATIVE_CALL_TEST_IMAGES = makeNativeCallTestImages(2);
const NATIVE_CALL_ENTRY_TEST_IMAGES = makeNativeCallTestImages(0);

function makeCompletionLatchTestImage(): TestBlua32Image {
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CLOSURE, 0, 0, 1, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(code, 3, OpCode.NEWT, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(code, 5, OpCode.RFE, 0, 0, 0, 0);
	return linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 3 },
			{ firstWord: 3, wordCount: 2, maxStack: 1 },
			{ firstWord: 5, wordCount: 1 },
		],
		functionIds: ['return_function', 'return_table', 'interrupt_return'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	});
}

const COMPLETION_LATCH_TEST_IMAGE = makeCompletionLatchTestImage();

function makeNativeCallCpu(nativeFunction: (cpu: CPU) => Value): {
	cpu: CPU;
	irqController: IrqController;
	callClosure: Closure;
	idleClosure: Closure;
} {
	const { cpu, irqController } = createTestBlua32PairCpu(NATIVE_CALL_TEST_IMAGES);
	cpu.setGlobalByKey(
		StringValue.get(cpu.stringPool.intern('native_callback')),
		nativeFunction(cpu),
	);
	assert.equal(cpu.runUntilDepth(0, 6), RunResult.Yielded);
	return {
		cpu,
		irqController,
		callClosure: cpu.readFrameRegister(0, 0) as Closure,
		idleClosure: cpu.readFrameRegister(0, 1) as Closure,
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
		callClosure: Runtime.prototype.callClosure,
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
	machine.resetDevices();
	return machine;
}

function makeHaltFrameRuntime(): Runtime {
	const { memory, cpu, irqController } = createTestBlua32PairCpu(HALT_TEST_IMAGES);
	assert.equal(cpu.runUntilDepth(0, 4), RunResult.Yielded);
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

const CART_LAUNCHER_SYSTEM_LUA_SOURCE = `
function irq() end
function exception() end
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;

function makeCompiledCartCpu(
	systemSource: string,
	cartSource: string,
	optLevel: OptimizationLevel = 0,
): {
	cpu: CPU;
	memory: Memory;
	irqController: IrqController;
	images: TestBlua32ImagePair;
} {
	const system = compileLuaChunkToProgram(
		parseLuaChunk(systemSource, 'system_vector.lua'),
		[],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cart = compileLuaChunkToProgram(
		parseLuaChunk(cartSource, 'cart_vector.lua'),
		[],
		{ entrySource: cartSource, programDomain: 'cart', optLevel },
	);
	const images = linkTestBlua32Pair(system, cart);
	const { cpu, memory, irqController } = createTestBlua32PairCpu(images);
	return { cpu, memory, irqController, images };
}

function makeCompiledIrqRuntime(source: string): { cpu: CPU; irqController: IrqController; cpuExecution: CpuExecutionState; state: FrameState } {
	const { cpu, memory, irqController } = makeCompiledCartCpu(CART_LAUNCHER_SYSTEM_LUA_SOURCE, source);
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

function assertFrameFunctionAddresses(cpu: CPU, expected: readonly number[]): void {
	assert.equal(cpu.getFrameDepth(), expected.length);
	for (let frameIndex = 0; frameIndex < expected.length; frameIndex += 1) {
		assert.equal(cpu.readFrameFunctionAddress(frameIndex), expected[frameIndex]);
	}
}

function assertInterruptFrameActive(cpu: CPU): void {
	assertFrameFunctionAddresses(cpu, [
		HALT_TEST_IMAGES.cartSymbols.functionAddresses[0],
		HALT_TEST_IMAGES.cartSymbols.functionAddresses[2],
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
	const { cpu } = makeCompiledCartCpu(CART_LAUNCHER_SYSTEM_LUA_SOURCE, source);
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

test('CPU closure calls that execute HALT without a scheduled interrupt park without host exception', () => {
	const { cpu, irqController } = createTestBlua32PairCpu(HALT_CLOSURE_TEST_IMAGES);
	assert.equal(cpu.runUntilDepth(0, 5), RunResult.Yielded);
	const haltClosure = cpu.readFrameRegister(0, 0) as Closure;
	const runtime = makeRuntime(cpu, irqController);
	cpu.instructionBudgetRemaining = 73;

	const out = runtime.callClosure(haltClosure, EMPTY_CALL_ARGS);

	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.getFrameDepth(), 2);
	assert.deepEqual(out, []);
});

test('external closure execution vectors a pending NMI through the physical CPU exception entry', () => {
	const { cpu, irqController, callClosure } = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'no_op_native',
		() => {},
	));
	const runtime = makeRuntime(cpu, irqController);
	cpu.requestNonMaskableInterrupt();

	const out = runtime.callClosure(callClosure, EMPTY_CALL_ARGS);

	assert.deepEqual(out, []);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.None);
});

test('IRQ mask starts closed and gates pending maskable IRQs', () => {
	const { memory, cpu, irqController: irq } = makeHaltCpu();

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

test('CPU closure calls continue after scheduler yield requests and restore the suspended budget', () => {
	const nativeCost = 7;
	const { cpu, irqController, callClosure } = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'yielding_native',
		() => cpu.requestYield(),
		{ base: nativeCost, perArg: 0, perRet: 0 },
	));
	const runtime = makeRuntime(cpu, irqController);

	cpu.instructionBudgetRemaining = 100;
	const out = runtime.callClosure(callClosure, EMPTY_CALL_ARGS);

	assert.deepEqual(out, []);
	assert.equal(cpu.instructionBudgetRemaining, 100);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('completion-call return routing survives save-state and exposes the CPU latch without copying', () => {
	const { cpu, irqController } = createTestSystemCpu(COMPLETION_LATCH_TEST_IMAGE);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const closure = cpu.completionValues[0] as Closure;
	const closureKey = StringValue.get(cpu.stringPool.intern('completion_call'));
	cpu.setGlobalByKey(closureKey, closure);

	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	const state = cpu.captureRuntimeState();
	assert.equal(state.frames.length, 1);
	assert.equal(state.frames[0].returnToCompletionLatch, true);

	cpu.restoreRuntimeState(state);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const restoredTable = cpu.completionValues[0] as Table;
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.completionValues[0], restoredTable);

	const restoredClosure = cpu.getGlobalByKey(closureKey) as Closure;
	const results = makeRuntime(cpu, irqController).callClosure(restoredClosure);
	assert.equal(results, cpu.completionValues);
	const borrowedTable = results[0];
	cpu.collectTrackedHeapBytes();
	assert.equal(results[0], borrowedTable);
});

test('CPU external closure host failures retain physical frames and restore the suspended budget', () => {
	const nativeCost = 7;
	const { cpu, irqController, callClosure } = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'throwing_native',
		() => {
			throw new Error('native boom');
		},
		{ base: nativeCost, perArg: 0, perRet: 0 },
	));
	const sliceStats = { begin: 0, end: 0 };
	const runtime = makeRuntime(cpu, irqController, sliceStats);

	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => runtime.callClosure(callClosure, EMPTY_CALL_ARGS),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100);
	assert.deepEqual(sliceStats, { begin: 1, end: 1 });
	assert.equal(cpu.getFrameDepth(), 2);
});

test('CPU frame executor rejects native Lua re-entry and closes the scheduler slice', () => {
	let runtime!: Runtime;
	let idleClosure!: Closure;
	const fixture = makeNativeCallCpu(cpu => cpu.createNativeFunction(
		'reentering_native',
		() => runtime.callClosure(idleClosure, EMPTY_CALL_ARGS),
		{ base: 7, perArg: 0, perRet: 0 },
	));
	const { cpu, irqController } = fixture;
	idleClosure = fixture.idleClosure;
	cpu.memory.cartridgeController.installRom(0, NATIVE_CALL_ENTRY_TEST_IMAGES.cartRomBytes);
	cpu.reset();

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
	assertInterruptFrameActive(cpu);

	returnFromInterruptFrame(runtime, state, cpu, irqController);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) === 0, true);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), true);
});

test('compiled IRQ vector dispatches through cart irq and acknowledges the device line', () => {
	const source = `
local irq_ack_addr<const> = 0x08000004
local irq_mask_addr<const> = 0x08000008
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
local irq_ack_addr<const> = 0x08000004
local irq_mask_addr<const> = 0x08000008
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
		const { cpu, irqController } = makeCompiledCartCpu(CART_LAUNCHER_SYSTEM_LUA_SOURCE, source, optLevel);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted, `O${optLevel} initial run`);
		irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.enterPendingInterrupt(), true, `O${optLevel} IRQ entry`);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted, `O${optLevel} resumed run`);
		assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('observed_before'))), 0, `O${optLevel} snapshot`);
		assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('observed_sequence'))), 1, `O${optLevel} live sequence`);
	}
});

test('linked system and cart handlers remain distinct across CPU save-state', () => {
	const systemSeenAddress = DYNAMIC_RAM_BASE + 0x2100;
	const cartSeenAddress = systemSeenAddress + 4;
	const systemSource = `
local irq_ack_addr<const> = 0x08000004
local irq_mask_addr<const> = 0x08000008
local irq_vblank<const> = 0x0004
function irq(flags)
	mem[${systemSeenAddress}] = flags
	mem[irq_ack_addr] = flags
end
function exception() end
mem[irq_mask_addr] = irq_vblank
halt_until_irq
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const cartSource = `
local irq_ack_addr<const> = 0x08000004
local irq_mask_addr<const> = 0x08000008
local irq_vblank<const> = 0x0004
function irq(flags)
	mem[${cartSeenAddress}] = flags
	mem[irq_ack_addr] = flags
end
function exception() end
mem[irq_mask_addr] = irq_vblank
halt_until_irq
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
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irqController, executionAddressSpace);
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.equal(memory.readMappedU32LE(systemSeenAddress), IRQ_VBLANK);
	assert.equal(memory.readMappedU32LE(cartSeenAddress), 0);
	const saved = cpu.captureRuntimeState();
	assert.equal(saved.systemGlobals.some(entry => entry.name === 'irq'), true);
	assert.equal(saved.globals.some(entry => entry.name === 'irq'), true);
	cpu.restoreRuntimeState(saved);

	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(memory.readMappedU32LE(cartSeenAddress), IRQ_VBLANK);
});

test('compiled IRQ vector storms on an unacknowledged level line', () => {
	const source = `
local irq_mask_addr<const> = 0x08000008
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
local irq_ack_addr<const> = 0x08000004
local irq_mask_addr<const> = 0x08000008
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
	assertInterruptFrameActive(cpu);

	const snapshot = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(snapshot);
	assertInterruptFrameActive(cpu);

	returnFromInterruptFrame(runtime, state, cpu, irqController);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), true);
});

test('manual NMI enters the exception root above a halted cart and RFE resumes at EPC', () => {
	const exceptionCauseAddress = DYNAMIC_RAM_BASE + 0x2000;
	const exceptionEpcAddress = exceptionCauseAddress + 4;
	const exceptionStatusAddress = exceptionCauseAddress + 8;
	const resumedAddress = exceptionCauseAddress + 12;
	const systemSource = `
function irq() end
function exception()
	mem[${exceptionCauseAddress}] = cop0.cause
	mem[${exceptionEpcAddress}] = cop0.epc
	mem[${exceptionStatusAddress}] = cop0.status
end
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const cartSource = `
halt_until_irq
mem[${resumedAddress}] = 1
`;
	const { cpu, memory, images } = makeCompiledCartCpu(systemSource, cartSource);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);

	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	const activeState = cpu.captureRuntimeState();
	assert.equal(activeState.causeWord, CPU_CAUSE_NMI);
	assert.equal(activeState.statusWord, CPU_STATUS_CART_ENTRY << 2);
	assert.equal(activeState.frames.at(-1)!.functionAddress, images.systemVectors.exceptionFunctionAddress);
	assert.equal(activeState.frames.at(-1)!.isExceptionFrame, true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);

	assert.equal(memory.readMappedU32LE(exceptionCauseAddress), CPU_CAUSE_NMI);
	assert.equal(memory.readMappedU32LE(exceptionEpcAddress), activeState.epcWord);
	assert.equal(memory.readMappedU32LE(exceptionStatusAddress), CPU_STATUS_CART_ENTRY << 2);
	assert.equal(memory.readMappedU32LE(resumedAddress), 1);
	assert.equal(cpu.captureRuntimeState().statusWord, CPU_STATUS_CART_ENTRY);
});

test('Hot Resume relocates exception callsites and EPC as interrupted continuation words', () => {
	const { cpu } = makeHaltCpu();
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.getFrameDepth(), 2);
	assert.equal(cpu.isExceptionFrame(1), true);

	const target = identityHotResumeRevision(HALT_TEST_IMAGES.cartImage);
	const epcWord = cpu.readEpcWord();
	const epcWordIndex = (epcWord - HALT_TEST_IMAGES.cartImage.header.textAddress) / INSTRUCTION_BYTES;
	const relocatedEpcWord = HALT_TEST_IMAGES.cartImage.functions[1].codeAddress;
	target.revision.pcAddresses[epcWordIndex] = relocatedEpcWord;
	target.revision.pcAddresses[epcWordIndex + 1]
		= HALT_TEST_IMAGES.cartImage.functions[2].codeAddress;

	applyHotResumeRelocation(
		cpu,
		buildHotResumeRelocation(cpu, [
			identityHotResumeRevision(HALT_TEST_IMAGES.systemImage),
			target,
			null,
		]),
	);
	assert.equal(cpu.readEpcWord(), relocatedEpcWord);
	assert.equal(cpu.readFrameCallSitePc(1), relocatedEpcWord);
});

test('Hot Resume relocates the saved EPC beneath a nested NMI through its interrupted owner frame', () => {
	const systemSource = `
function irq() end
function exception() end
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const cartSource = `
function irq() end
function exception() end
halt_until_irq
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
	const memory = new Memory({
		systemRom: linked.systemRomBytes,
		cartridgeSlots: cartridgeSlots(linked.cartRomBytes),
	});
	const irqController = new IrqController(memory);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irqController, executionAddressSpace);
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const interruptedFrameDepth = cpu.getFrameDepth();
	memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	const irqFrameIndex = interruptedFrameDepth;
	assert.equal(cpu.getFrameDepth(), interruptedFrameDepth + 1);
	assert.equal(cpu.isExceptionFrame(irqFrameIndex), true);
	assert.equal(cpu.isNonMaskableExceptionFrame(irqFrameIndex), false);
	assert.equal(cpu.readFrameExecutionDomain(irqFrameIndex - 1), 0);
	assert.equal(cpu.readFrameExecutionDomain(irqFrameIndex), 0);

	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);
	const nmiFrameIndex = irqFrameIndex + 1;
	assert.equal(cpu.getFrameDepth(), interruptedFrameDepth + 2);
	assert.equal(cpu.isNonMaskableExceptionFrame(nmiFrameIndex), true);
	assert.equal(cpu.readFrameExecutionDomain(nmiFrameIndex), -1);
	assert.equal(cpu.readLastExecutionDomain(), 0);

	const nmiReturnEpcWord = cpu.readNmiReturnEpcWord();
	applyHotResumeRelocation(
		cpu,
		buildHotResumeRelocation(cpu, [
			identityHotResumeRevision(linked.systemImage),
			identityHotResumeRevision(linked.cartImage),
			null,
		]),
	);
	assert.equal(cpu.readNmiReturnEpcWord(), nmiReturnEpcWord);
});

test('Hot Resume rejects an unmapped continuation before any physical state write', () => {
	const { memory, cpu } = makeHaltCpu();
	const target = identityHotResumeRevision(HALT_TEST_IMAGES.cartImage);
	target.revision.pcAddresses.fill(-1);
	const mediaRevision = memory.systemRomRevision();
	const functionAddress = cpu.readFrameFunctionAddress(0);
	const framePc = cpu.readFramePc(0);
	const lastPc = cpu.lastPc;

	assert.throws(
		() => buildHotResumeRelocation(cpu, [
			identityHotResumeRevision(HALT_TEST_IMAGES.systemImage),
			target,
			null,
		]),
		/Hot resume could not relocate/,
	);
	assert.equal(memory.systemRomRevision(), mediaRevision);
	assert.equal(cpu.readFrameFunctionAddress(0), functionAddress);
	assert.equal(cpu.readFramePc(0), framePc);
	assert.equal(cpu.lastPc, lastPc);
});

test('Hot Resume preserves captured slots on static-identity closures', () => {
	const source = `
local captured = 42
local wait<const> = function()
	halt_until_irq
	return captured
end
wait()
`;
	const { cpu, images } = makeCompiledCartCpu(CART_LAUNCHER_SYSTEM_LUA_SOURCE, source);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const frameIndex = cpu.getFrameDepth() - 1;
	assert.equal(cpu.getFrameUpvalueCount(frameIndex), 1);
	assert.equal(cpu.readFrameUpvalue(frameIndex, 0), 42);

	applyHotResumeRelocation(
		cpu,
		buildHotResumeRelocation(cpu, [
			identityHotResumeRevision(images.systemImage),
			identityHotResumeRevision(images.cartImage),
			null,
		]),
	);
	assert.equal(cpu.getFrameUpvalueCount(frameIndex), 1);
	assert.equal(cpu.readFrameUpvalue(frameIndex, 0), 42);
});

test('Hot Resume updates the physical last-PC latch', () => {
	const { cpu } = makeHaltCpu();
	const lastWordIndex = (
		cpu.lastPc - HALT_TEST_IMAGES.cartImage.header.textAddress
	) / INSTRUCTION_BYTES;
	const target = identityHotResumeRevision(HALT_TEST_IMAGES.cartImage);
	const relocatedPc = cpu.lastPc + INSTRUCTION_BYTES;
	target.revision.pcAddresses[lastWordIndex] = relocatedPc;

	applyHotResumeRelocation(
		cpu,
		buildHotResumeRelocation(cpu, [
			identityHotResumeRevision(HALT_TEST_IMAGES.systemImage),
			target,
			null,
		]),
	);
	assert.equal(cpu.lastPc, relocatedPc);
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

		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assertFrameFunctionAddresses(cpu, [
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

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assertFrameFunctionAddresses(cpu, [
		image.symbols.functionAddresses[0],
	]);
});

test('an uncaught Lua runtime error enters the exception root with CPU_CAUSE_CODE_TRAP instead of throwing to host', () => {
	const exceptionCauseAddress = DYNAMIC_RAM_BASE + 0x2200;
	const exceptionReasonAddress = exceptionCauseAddress + 4;
	const systemSource = `
function irq() end
function exception()
	mem[${exceptionCauseAddress}] = cop0.cause
	mem[${exceptionReasonAddress}] = cop0.lua_fault_reason
	halt_until_irq
end
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const cartSource = `
local nothing = nil
nothing()
`;
	const { cpu, memory, images } = makeCompiledCartCpu(systemSource, cartSource);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	let exceptionFrameFound = false;
	for (let frameIndex = 0; frameIndex < cpu.getFrameDepth(); frameIndex += 1) {
		if (cpu.readFrameFunctionAddress(frameIndex) === images.systemVectors.exceptionFunctionAddress) {
			exceptionFrameFound = true;
			break;
		}
	}
	assert.equal(exceptionFrameFound, true);
	assert.equal(memory.readMappedU32LE(exceptionCauseAddress), CPU_CAUSE_CODE_TRAP);
	assert.equal(memory.readMappedU32LE(exceptionReasonAddress), LUA_FAULT_REASON_CALL_NON_FUNCTION);
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
	const systemSource = `cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
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
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, new IrqController(memory), executionAddressSpace);
	cpu.reset();

	assert.equal(cpu.runUntilDepth(0, 10_000), RunResult.Halted);
	const frameDepth = cpu.getFrameDepth();
	assert.equal(frameDepth >= 3, true);
	for (let frameIndex = 0; frameIndex < frameDepth; frameIndex += 1) {
		const image = cpu.readFrameExecutionDomain(frameIndex) < 0
			? linked.systemImage
			: linked.cartImage;
		const pc = frameIndex + 1 < frameDepth
			? cpu.readFrameCallSitePc(frameIndex + 1)
			: cpu.lastPc;
		assert.equal(
			pc >= image.header.textAddress
				&& pc < image.header.textAddress + image.header.textByteCount,
			true,
		);
	}
	const callSitePc = cpu.readFrameCallSitePc(1);
	const relocation = buildHotResumeRelocation(cpu, [
		identityHotResumeRevision(linked.systemImage),
		identityHotResumeRevision(linked.cartImage),
		null,
	]);
	applyHotResumeRelocation(cpu, relocation);
	assert.equal(
		cpu.readFrameCallSitePc(1),
		callSitePc,
		'Hot Resume relocates a system child callsite through its cart parent domain',
	);
});

test('RFE cannot resume outside the interrupted function record', () => {
	const { cpu, haltFunctionAddress, systemExceptionFunctionAddress } = makeHaltCpu();
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.enterPendingInterrupt(), true);

	const state = cpu.captureRuntimeState();
	state.epcWord = HALT_TEST_IMAGES.cartImage.functions[1].codeAddress;
	cpu.restoreRuntimeState(state);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assertFrameFunctionAddresses(cpu, [
		haltFunctionAddress,
		systemExceptionFunctionAddress,
	]);
});

test('system NMI preempts a stalled cart IRQ root and RFE retries its unaccepted mapped store', () => {
	const exceptionCountAddress = DYNAMIC_RAM_BASE + 0x2300;
	const storeCompleteAddress = exceptionCountAddress + 4;
	const cartResumedAddress = exceptionCountAddress + 8;
	const systemSource = `
function irq() end
function exception()
	mem[${exceptionCountAddress}] = mem[${exceptionCountAddress}] + 1
end
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const cartSource = `
local irq_ack_addr<const> = ${IO_IRQ_ACK}
local irq_mask_addr<const> = ${IO_IRQ_MASK}
local irq_vblank<const> = ${IRQ_VBLANK}
local data_port<const>: *word = ${IO_APU_TRANSFER_DATA}
function irq(flags)
	*data_port = 0x12345678
	mem[${storeCompleteAddress}] = mem[${storeCompleteAddress}] + 1
	mem[irq_ack_addr] = flags
end
mem[irq_mask_addr] = irq_vblank
halt_until_irq
mem[${cartResumedAddress}] = 1
`;
	const { cpu, memory, irqController } = makeCompiledCartCpu(systemSource, cartSource);
	const port = { ready: false, writes: 0 };
	memory.mapIoWrite(IO_APU_TRANSFER_DATA, port, context => {
		context.writes += 1;
	});
	memory.mapIoWriteReady(IO_APU_TRANSFER_DATA, context => context.ready);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isMemoryWriteBlocked(), true);
	assert.equal(port.writes, 0);
	assert.equal(memory.readMappedU32LE(storeCompleteAddress), 0);

	cpu.abortStalledMemoryWrite();
	cpu.requestNonMaskableInterrupt();
	assert.equal(cpu.peekPendingInterrupt(), AcceptedInterruptKind.NonMaskable);
	assert.equal(cpu.enterPendingInterrupt(), true);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(memory.readMappedU32LE(exceptionCountAddress), 1);
	assert.equal(cpu.isMemoryWriteBlocked(), true);
	assert.equal(port.writes, 0);
	assert.equal(memory.readMappedU32LE(storeCompleteAddress), 0);

	port.ready = true;
	cpu.resumeMemoryWrite(IO_APU_TRANSFER_DATA);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(port.writes, 1);
	assert.equal(memory.readMappedU32LE(storeCompleteAddress), 1);
	assert.equal(memory.readMappedU32LE(cartResumedAddress), 1);
});

test('user CP0 access vectors synchronously and a supervisor EPC write selects the resume instruction', () => {
	const faultCauseAddress = DYNAMIC_RAM_BASE + 0x2400;
	const continuedAddress = faultCauseAddress + 4;
	const systemSource = `
function irq() end
function exception()
	mem[${faultCauseAddress}] = cop0.cause
	cop0.epc = cop0.epc + 4
end
cop0.exec = mem[${CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
	const cartSource = `
fault_value = cop0.status
mem[${continuedAddress}] = 1
`;
	for (const optLevel of [0, 3] as const) {
		const { cpu, memory } = makeCompiledCartCpu(systemSource, cartSource, optLevel);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);

		assert.equal(memory.readMappedU32LE(faultCauseAddress), CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		assert.equal(memory.readMappedU32LE(continuedAddress), 1);
		assert.equal(cpu.captureRuntimeState().statusWord, CPU_STATUS_CART_ENTRY);
	}
});

test('CPU mapped bus errors enter the system exception vector without committing a faulting tail', () => {
	const unmappedAddress = 0x06000000;
	const systemCode = new Uint8Array(13 * INSTRUCTION_BYTES);
	writeInstruction(systemCode, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(systemCode, 1, OpCode.LOAD_MEM, 0, 0, MemoryAccessKind.U32LE, 0);
	writeInstruction(systemCode, 2, OpCode.MTC0, 0, COP0_EXEC, 0, 0);
	writeInstruction(systemCode, 3, OpCode.MFC0, 0, COP0_CAUSE, 0, 0);
	writeInstruction(systemCode, 4, OpCode.RFE, 0, 0, 0, 0);
	writeInstruction(systemCode, 5, OpCode.LOADK, 0, 0, 1, 0);
	writeInstruction(systemCode, 6, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(systemCode, 7, OpCode.K1, 2, 0, 0, 0);
	writeInstruction(systemCode, 8, OpCode.K1, 3, 0, 0, 0);
	writeInstruction(systemCode, 9, OpCode.K1, 4, 0, 0, 0);
	writeInstruction(systemCode, 10, OpCode.K1, 5, 0, 0, 0);
	writeInstruction(systemCode, 11, OpCode.STORE_MEM_WORDS_D, 1, 0, 5, 0);
	writeInstruction(systemCode, 12, OpCode.RET, 0, 0, 0, 0);
	const systemSource: TestBlua32Source = {
		text: systemCode,
		constants: [
			CART_ROM_BASE + BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET,
			IO_SYS_BUS_FAULT_CODE - IO_WORD_SIZE,
		],
		functions: [
			{ firstWord: 0, wordCount: 3 },
			{ firstWord: 3, wordCount: 2 },
			{ firstWord: 5, wordCount: 8, maxStack: 6 },
		],
		functionIds: ['cart_launcher', 'system_exception', 'system_bus_burst'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	};
	const cartCode = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(cartCode, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(cartCode, 1, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(cartCode, 2, OpCode.LOAD_MEM_D, 1, 0, MemoryAccessKind.Word, 0);
	writeInstruction(cartCode, 3, OpCode.RET, 1, 1, 0, 0);
	writeInstruction(cartCode, 4, OpCode.RFE, 0, 0, 0, 0);
	const images = linkRawTestBlua32Pair(systemSource, {
		text: cartCode,
		constants: [unmappedAddress],
		functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 2 },
			{ firstWord: 4, wordCount: 1 },
		],
		functionIds: ['user_bus_load', 'cart_irq'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const { memory, cpu } = createTestBlua32PairCpu(images);
	const systemExceptionAddress = images.systemSymbols.functionAddresses[1];

	assert.equal(cpu.runUntilDepth(0, 8), RunResult.Yielded);
	const loadFault = cpu.captureRuntimeState();
	assert.equal(loadFault.causeWord, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	assert.equal(loadFault.epcWord, images.cartImage.header.textAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(loadFault.badAddressWord, 0);
	assert.equal(loadFault.frames.at(-1)!.functionAddress, systemExceptionAddress);
	assert.equal(cpu.readFrameRegister(0, 1), 1);
	loadFault.epcWord += INSTRUCTION_BYTES;
	cpu.restoreRuntimeState(loadFault);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(cpu.completionValues, [1]);

	memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
	memory.readMappedU8(unmappedAddress);
	const systemBurstImage = linkRawTestSystemBlua32({
		...systemSource,
		startupFunctionIndex: 2,
	});
	memory.installSystemRom(systemBurstImage.romBytes);
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 10), RunResult.Yielded);
	const burstFault = cpu.captureRuntimeState();
	assert.equal(burstFault.causeWord, CPU_CAUSE_CODE_DATA_BUS_ERROR);
	assert.equal(burstFault.epcWord, systemBurstImage.image.header.textAddress + 11 * INSTRUCTION_BYTES);
	assert.equal(burstFault.statusWord, CPU_STATUS_SYSTEM_ENTRY << 2);
	assert.equal(burstFault.frames.at(-1)!.functionAddress, systemBurstImage.symbols.functionAddresses[1]);
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

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(cpu.completionValues, [0x5a, Math.PI]);
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
	cpu.reset();
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
