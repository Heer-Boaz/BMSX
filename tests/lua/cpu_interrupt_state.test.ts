import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BuiltinFunctionId, CPU, EMPTY_CALL_ARGS, Table, createBuiltinFunction, OpCode, RunResult, StringValue, type Closure, type Program, type ProgramMetadata, type Proto, type Value } from '../../machine/ts/machine/cpu/cpu';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/machine/cpu/instruction_format';
import { BASE_CYCLES, encodeFixedCallArgCount } from '../../machine/ts/machine/cpu/opcode_info';
import {
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE,
	CPU_CAUSE_NMI,
	CPU_STATUS_CART_ENTRY,
} from '../../machine/ts/machine/cpu/cop0';
import { IO_IRQ_MASK, IO_IRQ_FLAGS, IRQ_VBLANK } from '../../machine/ts/machine/bus/io';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Machine } from '../../machine/ts/machine/machine';
import type { MicrotaskQueue } from '../../machine/ts/machine/scheduler/microtask_queue';
import { captureMachineSaveState, captureMachineState, restoreMachineSaveState, restoreMachineState } from '../../machine/ts/machine/save_state';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/lua/compiler';
import { callClosureIntoWithScheduler } from '../../machine/ts/ide/runtime/closure_executor';
import { inflateExecutableProgramImage } from '../../machine/ts/machine/program/linker';
import { CpuExecutionState } from '../../machine/ts/machine/runtime/cpu_executor';
import { FrameLoopState } from '../../machine/ts/machine/runtime/frame/loop';
import { FrameSchedulerState } from '../../machine/ts/machine/scheduler/frame';
import { Runtime, type FrameState } from '../../machine/ts/machine/runtime/runtime';
import { parseLuaChunk } from './cpu_test_harness';

function makeProto(codeLen: number): Proto {
	return {
		entryPC: 0,
		codeLen,
		numParams: 0,
		isVararg: false,
		maxStack: 1,
		upvalueDescs: [],
		staticClosure: false,
	};
}

function makeMetadata(protoCount = 2): ProgramMetadata {
	return {
		debugRanges: new Array(protoCount).fill(null),
		protoIds: new Array(protoCount).fill(null).map((_, index) => `proto_${index}`),
		localSlotsByProto: new Array(protoCount).fill(null).map(() => []),
		upvalueNamesByProto: new Array(protoCount).fill(null).map(() => []),
		globalNames: [],
		systemGlobalNames: [],
		exportProtoIdBySlot: {},
	};
}

function makeProgram(cpu: CPU): Program {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RFE, 0, 0, 0, 0);
	const pool = cpu.stringPool;
	return {
		code,
		programRom: code,
		programRomTextByteLength: code.byteLength,
		constPool: [],
		protos: [
			makeProto(INSTRUCTION_BYTES),
			{ ...makeProto(INSTRUCTION_BYTES), entryPC: INSTRUCTION_BYTES },
			{ ...makeProto(INSTRUCTION_BYTES), entryPC: 2 * INSTRUCTION_BYTES },
		],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

type InstructionSpec = readonly [OpCode, number, number, number, number];

function makeInstructionProgram(cpu: CPU, instructions: readonly InstructionSpec[]): Program {
	const code = new Uint8Array(instructions.length * INSTRUCTION_BYTES);
	for (let index = 0; index < instructions.length; index += 1) {
		const instruction = instructions[index];
		writeInstruction(code, index, instruction[0], instruction[1], instruction[2], instruction[3], instruction[4]);
	}
	const pool = cpu.stringPool;
	return {
		code,
		programRom: code,
		programRomTextByteLength: code.byteLength,
		constPool: [],
		protos: [{ ...makeProto(code.byteLength), maxStack: 2 }, { ...makeProto(0), entryPC: code.byteLength }],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

function makeSingleOpcodeProgram(cpu: CPU, op: OpCode): Program {
	return makeInstructionProgram(cpu, [[op, 0, 0, 0, 0]]);
}

function makeCpuWithProgram(programForCpu: (cpu: CPU) => Program): { memory: Memory; cpu: CPU; irqController: IrqController } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	const program = programForCpu(cpu);
	const metadata = makeMetadata(program.protos.length);
	cpu.setProgram(program, metadata, metadata, 0, 0, 0);
	return { memory, cpu, irqController };
}

function makeThrowingNativeProgram(cpu: CPU, nativeFunction: Value): Program {
	const code = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CALL, 0, encodeFixedCallArgCount(0), 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RET, 0, 0, 0, 0);
	const pool = cpu.stringPool;
	return {
		code,
		programRom: code,
		programRomTextByteLength: code.byteLength,
		constPool: [nativeFunction],
		protos: [makeProto(3 * INSTRUCTION_BYTES), { ...makeProto(INSTRUCTION_BYTES), entryPC: 3 * INSTRUCTION_BYTES }],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

function makeRuntime(cpu: CPU, irqController: IrqController, sliceStats?: { begin: number; end: number }): Runtime {
	return {
		machine: {
			cpu,
			memory: cpu.memory,
			irqController,
			scheduler: {
				nowCycles: 0,
				hasDueTimer: () => false,
				nextDeadline: () => Number.MAX_SAFE_INTEGER,
				beginCpuSlice: () => {
					if (sliceStats) {
						sliceStats.begin += 1;
					}
				},
				endCpuSlice: () => {
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
		programVectors: { resetProtoIndex: 0, sectionInitProtoIndex: 0, irqProtoIndex: 0, exceptionProtoIndex: 0 },
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

function makeMachine(): Machine {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const input = {
		getPlayerInput: () => ({
			checkActionTriggered: () => false,
			consumeAction: () => {},
			popContext: () => {},
			pushContext: () => {},
		}),
		beginFrame: () => {},
	};
	const machine = new Machine(
		memory,
		{ x: 256, y: 212 },
		input as never,
		INLINE_MICROTASKS,
	);
	machine.initializeSystemIo();
	machine.resetDevices();
	return machine;
}

function makeHaltFrameRuntime(): Runtime {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	const program = makeProgram(cpu);
	const metadata = makeMetadata(program.protos.length);
	cpu.setProgram(program, metadata, metadata, 2, 2, 2);
	cpu.start(0);
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
			scheduler,
			advanceDevices: (cycles: number) => {
				scheduler.nowCycles += cycles;
			},
		},
		vblank: {
			tickCompleted: false,
			beginTick: () => {},
			abandonTick: () => {},
			handleBeginTimer: () => {},
			handleEndTimer: () => {},
		},
		frameScheduler: null as never,
		frameLoop: null as never,
		cpuExecution: null as never,
		timing: {
			cycleBudgetPerFrame: 100,
			frameDurationMs: 20,
		},
		luaInitialized: true,
		luaRuntimeFailed: false,
		pendingCall: 'entry' as const,
		cartEntryAvailable: true,
		programVectors: {
			resetProtoIndex: 0,
			sectionInitProtoIndex: 0,
			irqProtoIndex: 2,
			exceptionProtoIndex: 2,
		},
		luaGate: { ready: true },
	} as unknown as Runtime;
	runtime.frameLoop = new FrameLoopState(runtime);
	runtime.cpuExecution = new CpuExecutionState(runtime);
	runtime.frameScheduler = {
		lastTickSequence: 0,
		startScheduledFrame: () => {
			runtime.frameLoop.beginFrameState();
			return true;
		},
		refillFrameBudget: () => true,
	} as never;
	return runtime;
}

function makeCompiledIrqRuntime(source: string): { cpu: CPU; irqController: IrqController; cpuExecution: CpuExecutionState; state: FrameState } {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'irq_vector.lua'), [], { entrySource: source });
	const image = encodeCompiledProgramImage(compiled);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	cpu.setProgram(
		inflateExecutableProgramImage(image),
		image.link.symbols,
		compiled.metadata,
		image.vectors.irqProtoIndex,
		image.vectors.irqProtoIndex,
		image.vectors.exceptionProtoIndex,
	);
	cpu.start(image.vectors.resetProtoIndex);
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
			scheduler,
			advanceDevices: (cycles: number) => { scheduler.nowCycles += cycles; },
		},
		vblank: { tickCompleted: false, beginTick: () => {}, abandonTick: () => {}, handleBeginTimer: () => {}, handleEndTimer: () => {} },
		programVectors: image.vectors,
	} as unknown as Runtime;
	return {
		cpu,
		irqController,
		cpuExecution: new CpuExecutionState(runtime),
		state: makeFrameState(),
	};
}

function makeCompiledCpu(source: string, optLevel: 0 | 3 = 0): { cpu: CPU; irqController: IrqController; image: ReturnType<typeof encodeCompiledProgramImage> } {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'supervisor_vector.lua'), [], { entrySource: source, optLevel });
	const image = encodeCompiledProgramImage(compiled);
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	cpu.setProgram(
		inflateExecutableProgramImage(image),
		image.link.symbols,
		compiled.metadata,
		image.vectors.irqProtoIndex,
		image.vectors.irqProtoIndex,
		image.vectors.exceptionProtoIndex,
	);
	cpu.start(image.vectors.resetProtoIndex);
	return { cpu, irqController, image };
}

function runCompiledVblankIrq(source: string): { cpu: CPU; irqController: IrqController } {
	const { cpu, irqController, cpuExecution, state } = makeCompiledIrqRuntime(source);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpuExecution.runHaltedUntilIrq(state), false);
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
	assert.deepEqual(cpu.getCallStack().map(frame => frame.protoIndex), [0, 2]);
	assert.equal(cpu.canAcceptMaskableInterruptLine(), false);
}

function returnFromInterruptFrame(runtime: Runtime, state: FrameState, cpu: CPU, irqController: IrqController): void {
	irqController.acknowledge(IRQ_VBLANK);
	runtime.cpuExecution.runWithBudget(state);
	assert.equal(cpu.getFrameDepth(), 0);
}

test('CPU protected calls preserve halted callee stop state without Lua results', () => {
	for (const builtinId of [BuiltinFunctionId.PCall, BuiltinFunctionId.XPCall]) {
		const { cpu: haltedCpu } = makeCpuWithProgram(cpu => makeSingleOpcodeProgram(cpu, OpCode.HALT));
		const haltedOut: Value[] = [];
		const haltedArgs = builtinId === BuiltinFunctionId.XPCall
			? [haltedCpu.rootClosure(0), haltedCpu.rootClosure(1)]
			: [haltedCpu.rootClosure(0)];

		haltedCpu.callBuiltinFunction(createBuiltinFunction(builtinId), haltedArgs, haltedOut);

		assert.equal(haltedCpu.isHaltedUntilIrq(), true);
		assert.equal(haltedCpu.getFrameDepth(), 1);
		assert.deepEqual(haltedOut, []);
	}
});

function callClosureInto(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	runtime.callClosureInto(fn, args, out);
}

test('CPU closure calls that execute HALT without a scheduled interrupt park without host exception', () => {
	for (const run of [callClosureInto, callClosureIntoWithScheduler]) {
		const { cpu, irqController } = makeCpuWithProgram(makeProgram);
		const closure = cpu.rootClosure(0);
		cpu.start(1);
		const runtime = makeRuntime(cpu, irqController);
		const out: Value[] = [];
		cpu.instructionBudgetRemaining = 73;

		run(runtime, closure, EMPTY_CALL_ARGS, out);

		assert.equal(cpu.isHaltedUntilIrq(), true);
		assert.equal(cpu.getFrameDepth(), 2);
		assert.deepEqual(out, []);
	}
});

test('host external closure calls wake from pending IRQ without vectoring', () => {
	const { cpu, irqController } = makeCpuWithProgram(makeProgram);
	const closure = cpu.rootClosure(0);
	cpu.start(1);
	const runtime = makeRuntime(cpu, irqController);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);

	const out: Value[] = [];
	callClosureInto(runtime, closure, EMPTY_CALL_ARGS, out);

	assert.deepEqual(out, []);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal((runtime.machine.irqController.captureState().pendingFlags & IRQ_VBLANK) !== 0, true);
});

test('IRQ mask starts closed and gates pending maskable IRQs', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq);
	const metadata = makeMetadata();
	cpu.setProgram(makeProgram(cpu), metadata, metadata, 0, 0, 0);
	cpu.start(0);

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
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	const nativeCost = 7;
	const yieldingNative = cpu.createNativeFunction('yielding_native', () => {
		cpu.requestYield();
	}, { base: nativeCost, perArg: 0, perRet: 0 });
	const metadata = makeMetadata();
	cpu.setProgram(makeThrowingNativeProgram(cpu, yieldingNative), metadata, metadata, 0, 0, 0);
	const closure = cpu.rootClosure(0);
	cpu.start(1);
	const spent = BASE_CYCLES[OpCode.LOADK] + BASE_CYCLES[OpCode.CALL] + nativeCost + BASE_CYCLES[OpCode.RET];
	const runtime = makeRuntime(cpu, irqController);
	const out: Value[] = [];

	cpu.instructionBudgetRemaining = 100;
	callClosureInto(runtime, closure, EMPTY_CALL_ARGS, out);

	assert.deepEqual(out, []);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU external closure calls that throw after executing preserve spent budget', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	const nativeCost = 7;
	const throwingNative = cpu.createNativeFunction('throwing_native', () => {
		throw new Error('native boom');
	}, { base: nativeCost, perArg: 0, perRet: 0 });
	const metadata = makeMetadata();
	cpu.setProgram(makeThrowingNativeProgram(cpu, throwingNative), metadata, metadata, 0, 0, 0);
	const closure = cpu.rootClosure(0);
	cpu.start(1);
	const spent = BASE_CYCLES[OpCode.LOADK] + BASE_CYCLES[OpCode.CALL] + nativeCost;
	const directRuntime = makeRuntime(cpu, irqController);
	const out: Value[] = [];

	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => callClosureInto(directRuntime, closure, EMPTY_CALL_ARGS, out),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.equal(cpu.getFrameDepth(), 1);

	const sliceStats = { begin: 0, end: 0 };
	const schedulerRuntime = makeRuntime(cpu, irqController, sliceStats);
	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => callClosureIntoWithScheduler(schedulerRuntime, closure, EMPTY_CALL_ARGS, out),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.deepEqual(sliceStats, { begin: 1, end: 1 });
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU frame executor closes scheduler slice when execution throws', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const irqController = new IrqController(memory);
	const cpu = new CPU(memory, irqController);
	const throwingNative = cpu.createNativeFunction('throwing_native', () => {
		throw new Error('native boom');
	}, { base: 7, perArg: 0, perRet: 0 });
	const metadata = makeMetadata();
	cpu.setProgram(makeThrowingNativeProgram(cpu, throwingNative), metadata, metadata, 0, 0, 0);
	cpu.start(0);

	const sliceStats = { begin: 0, end: 0 };
	const runtime = makeRuntime(cpu, irqController, sliceStats);
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
		/native boom/,
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

test('frame loop vectors a pending IRQ above a halted cart frame', () => {
	const runtime = makeHaltFrameRuntime();
	const cpu = runtime.machine.cpu;
	const irqController = runtime.machine.irqController;

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);

	irqController.raise(IRQ_VBLANK);
	const state = makeFrameState();
	const tickCompleted = runtime.cpuExecution.runHaltedUntilIrq(state);

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
	const moduleCache = new Map<string, Value>();
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	irqController.raise(IRQ_VBLANK);
	const state = makeFrameState();
	runtime.cpuExecution.runHaltedUntilIrq(state);
	assertInterruptFrameActive(cpu, irqController);

	const snapshot = cpu.captureRuntimeState(moduleCache);
	cpu.restoreRuntimeState(snapshot, moduleCache);
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
	const activeState = cpu.captureRuntimeState(new Map());
	assert.equal(activeState.causeWord, CPU_CAUSE_NMI);
	assert.equal(activeState.statusWord, CPU_STATUS_CART_ENTRY << 2);
	assert.equal(activeState.frames[1].protoIndex, image.vectors.exceptionProtoIndex);
	assert.equal(activeState.frames[1].isExceptionFrame, true);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);

	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_cause'))), CPU_CAUSE_NMI);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_epc'))), activeState.epcWord);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('exception_status'))), CPU_STATUS_CART_ENTRY << 2);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('resumed'))), 1);
	assert.equal(cpu.captureRuntimeState(new Map()).statusWord, CPU_STATUS_CART_ENTRY);
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
		assert.equal(cpu.captureRuntimeState(new Map()).statusWord, CPU_STATUS_CART_ENTRY);
	}
});

test('CPU runtime snapshot preserves nested table object identities', () => {
	const { cpu } = makeCpuWithProgram(makeProgram);
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
	const moduleCache = new Map<string, Value>();

	const snapshot = cpu.captureRuntimeState(moduleCache);
	cpu.restoreRuntimeState(snapshot, moduleCache);

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

test('IRQ state restore preserves asserted line and cart-visible flags', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
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
