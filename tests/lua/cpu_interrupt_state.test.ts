import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CPU, createNativeFunction, OpCode, RunResult, StringValue, type Program, type ProgramMetadata, type Proto, type Value } from '../../machine/ts/machine/cpu/cpu';
import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/machine/cpu/instruction_format';
import { BASE_CYCLES, encodeFixedCallArgCount } from '../../machine/ts/machine/cpu/opcode_info';
import { IO_IRQ_MASK, IO_IRQ_FLAGS, IRQ_VBLANK } from '../../machine/ts/machine/bus/io';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Machine } from '../../machine/ts/machine/machine';
import { captureMachineSaveState, captureMachineState, restoreMachineSaveState, restoreMachineState } from '../../machine/ts/machine/save_state';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/machine/program/compiler';
import { callClosureInto, callClosureIntoWithScheduler } from '../../machine/ts/machine/program/executor';
import { inflateExecutableProgramImage } from '../../machine/ts/machine/program/linker';
import { CpuExecutionState } from '../../machine/ts/machine/runtime/cpu_executor';
import { FrameLoopState } from '../../machine/ts/machine/runtime/frame/loop';
import { FrameSchedulerState } from '../../machine/ts/machine/scheduler/frame';
import type { FrameState, Runtime } from '../../machine/ts/machine/runtime/runtime';

function parseSource(source: string, path = 'irq_vector.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

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

function makeMetadata(): ProgramMetadata {
	return {
		debugRanges: [null, null],
		protoIds: ['main', 'external'],
		localSlotsByProto: [[], []],
		upvalueNamesByProto: [[], []],
		globalNames: [],
		systemGlobalNames: [],
		exportProtoIdBySlot: {},
	};
}

function makeProgram(cpu: CPU): Program {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 0, 0, 0);
	const pool = cpu.stringPool;
	return {
		code,
		programRom: code,
		programRomTextByteLength: code.byteLength,
		constPool: [],
		protos: [makeProto(INSTRUCTION_BYTES), { ...makeProto(INSTRUCTION_BYTES), entryPC: INSTRUCTION_BYTES }],
		stringPool: pool,
		constPoolStringPool: pool,
	};
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

function makeRuntime(cpu: CPU, sliceStats?: { begin: number; end: number }): Runtime {
	const irqMemory = new Memory({ systemRom: new Uint8Array(0) });
	return {
		machine: {
			cpu,
			memory: irqMemory,
			irqController: new IrqController(irqMemory),
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
		programVectors: null,
	} as unknown as Runtime;
}

function makeMachine(): Machine {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
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
	);
	machine.initializeSystemIo();
	machine.resetDevices();
	return machine;
}

function makeHaltFrameRuntime(): Runtime {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
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
			irqController: new IrqController(memory),
			scheduler,
			vdp: {
				beginFrame: () => {},
			},
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
		tickEnabled: true,
		luaInitialized: true,
		luaRuntimeFailed: false,
		pendingCall: 'entry' as const,
		executionOverlayActive: false,
		debuggerPaused: false,
		cartEntryAvailable: true,
		programVectors: {
			resetProtoIndex: 0,
			sectionInitProtoIndex: null,
			irqProtoIndex: 1,
		},
		luaGate: { ready: true },
		cartBoot: {
			processPending: () => false,
		},
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
	const compiled = compileLuaChunkToProgram(parseSource(source), [], { entrySource: source });
	const image = encodeCompiledProgramImage(compiled);
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(inflateExecutableProgramImage(image, compiled.metadata), compiled.metadata);
	cpu.start(image.vectors.resetProtoIndex);
	const irqController = new IrqController(memory);
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
			vdp: { beginFrame: () => {} },
			advanceDevices: (cycles: number) => { scheduler.nowCycles += cycles; },
		},
		vblank: { tickCompleted: false, beginTick: () => {}, abandonTick: () => {}, handleBeginTimer: () => {}, handleEndTimer: () => {} },
		programVectors: { resetProtoIndex: image.vectors.resetProtoIndex, sectionInitProtoIndex: null, irqProtoIndex: image.vectors.irqProtoIndex },
	} as unknown as Runtime;
	return {
		cpu,
		irqController,
		cpuExecution: new CpuExecutionState(runtime),
		state: {
			haltGame: false,
			updateExecuted: false,
			luaFaulted: false,
			cycleBudgetRemaining: 100,
			cycleBudgetGranted: 100,
			cycleCarryGranted: 0,
			activeCpuUsedCycles: 0,
		},
	};
}

test('CPU external closure calls cannot wake HALT without an accepted interrupt', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(0);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.throws(
		() => cpu.callExternal({ protoIndex: 1, upvalues: [] }),
		/Cannot enter CPU while halted until IRQ/,
	);
	assert.equal(cpu.isHaltedUntilIrq(), true);
});

test('CPU external closure calls rejected while already halted preserve budget state', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(0);
	const runtime = makeRuntime(cpu);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);

	cpu.instructionBudgetRemaining = 37;
	assert.throws(
		() => callClosureInto(runtime, { protoIndex: 1, upvalues: [] }, [], []),
		/Cannot enter CPU while halted until IRQ/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 37);

	cpu.instructionBudgetRemaining = 41;
	assert.throws(
		() => callClosureIntoWithScheduler(runtime, { protoIndex: 1, upvalues: [] }, [], []),
		/Cannot enter CPU while halted until IRQ/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 41);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU closure calls that execute HALT without a scheduled interrupt unwind', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(1);
	const runtime = makeRuntime(cpu);

	assert.throws(
		() => callClosureIntoWithScheduler(runtime, { protoIndex: 0, upvalues: [] }, [], []),
		/CPU halted with no scheduled interrupt/,
	);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('host external closure calls wake from pending IRQ without vectoring', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(1);
	const runtime = makeRuntime(cpu);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);

	const out: Value[] = [];
	callClosureInto(runtime, { protoIndex: 0, upvalues: [] }, [], out);

	assert.deepEqual(out, []);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal((runtime.machine.irqController.captureState().pendingFlags & IRQ_VBLANK) !== 0, true);
});

test('IRQ mask starts closed and gates pending maskable IRQs', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(0);

	irq.raise(IRQ_VBLANK);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0);
	assert.equal(cpu.canAcceptMaskableInterruptLine(irq), false);

	memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(irq), true);

	memory.writeValue(IO_IRQ_MASK, 0);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0);
	assert.equal(cpu.canAcceptMaskableInterruptLine(irq), false);
});

test('CPU closure calls continue after scheduler yield requests', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const nativeCost = 7;
	const yieldingNative = createNativeFunction('yielding_native', () => {
		cpu.requestYield();
	}, { base: nativeCost, perArg: 0, perRet: 0 });
	cpu.setProgram(makeThrowingNativeProgram(cpu, yieldingNative), makeMetadata());
	cpu.start(1);
	const spent = BASE_CYCLES[OpCode.LOADK] + BASE_CYCLES[OpCode.CALL] + nativeCost + BASE_CYCLES[OpCode.RET];
	const runtime = makeRuntime(cpu);
	const out: Value[] = [];

	cpu.instructionBudgetRemaining = 100;
	callClosureInto(runtime, { protoIndex: 0, upvalues: [] }, [], out);

	assert.deepEqual(out, []);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU external closure calls that throw after executing preserve spent budget', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const nativeCost = 7;
	const throwingNative = createNativeFunction('throwing_native', () => {
		throw new Error('native boom');
	}, { base: nativeCost, perArg: 0, perRet: 0 });
	cpu.setProgram(makeThrowingNativeProgram(cpu, throwingNative), makeMetadata());
	cpu.start(1);
	const spent = BASE_CYCLES[OpCode.LOADK] + BASE_CYCLES[OpCode.CALL] + nativeCost;
	const directRuntime = makeRuntime(cpu);

	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => callClosureInto(directRuntime, { protoIndex: 0, upvalues: [] }, [], []),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.equal(cpu.getFrameDepth(), 1);

	const sliceStats = { begin: 0, end: 0 };
	const schedulerRuntime = makeRuntime(cpu, sliceStats);
	cpu.instructionBudgetRemaining = 100;
	assert.throws(
		() => callClosureIntoWithScheduler(schedulerRuntime, { protoIndex: 0, upvalues: [] }, [], []),
		/native boom/,
	);
	assert.equal(cpu.instructionBudgetRemaining, 100 - spent);
	assert.deepEqual(sliceStats, { begin: 1, end: 1 });
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU frame executor closes scheduler slice when execution throws', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const throwingNative = createNativeFunction('throwing_native', () => {
		throw new Error('native boom');
	}, { base: 7, perArg: 0, perRet: 0 });
	cpu.setProgram(makeThrowingNativeProgram(cpu, throwingNative), makeMetadata());
	cpu.start(0);

	const sliceStats = { begin: 0, end: 0 };
	const runtime = makeRuntime(cpu, sliceStats);
	const executor = new CpuExecutionState(runtime);
	assert.throws(
		() => executor.runWithBudget({
			haltGame: false,
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

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);

	runtime.machine.irqController.raise(IRQ_VBLANK);
	const state = {
		haltGame: false,
		updateExecuted: false,
		luaFaulted: false,
		cycleBudgetRemaining: 100,
		cycleBudgetGranted: 100,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
	};
	const tickCompleted = runtime.cpuExecution.runHaltedUntilIrq(state);

	assert.equal(tickCompleted, false);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal(cpu.getFrameDepth(), 2);
	assert.deepEqual(cpu.getCallStack().map(frame => frame.protoIndex), [0, 1]);
	assert.equal(cpu.canAcceptMaskableInterruptLine(runtime.machine.irqController), false);

	runtime.machine.irqController.acknowledge(IRQ_VBLANK);
	runtime.cpuExecution.runWithBudget(state);
	assert.equal(cpu.getFrameDepth(), 0);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.equal((runtime.machine.irqController.captureState().pendingFlags & IRQ_VBLANK) === 0, true);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(runtime.machine.irqController), true);
});

test('compiled IRQ vector dispatches through cart irq and acknowledges the device line', () => {
	const source = `
local irq_ack_addr<const> = 0x0800010c
local irq_mask_addr<const> = 0x08000110
local irq_vblank<const> = 0x0010
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
	const { cpu, irqController, cpuExecution, state } = makeCompiledIrqRuntime(source);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpuExecution.runHaltedUntilIrq(state), false);
	cpuExecution.runWithBudget(state);

	const irqSeen = cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('irq_seen')));
	assert.equal(irqSeen, IRQ_VBLANK);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) === 0, true);
});

test('compiled IRQ vector storms on an unacknowledged level line', () => {
	const source = `
local irq_mask_addr<const> = 0x08000110
local irq_vblank<const> = 0x0010
irq_seen = 0
function irq(flags)
	irq_seen = irq_seen + 1
end
mem[irq_mask_addr] = irq_vblank
while true do
	halt_until_irq
end
`;
	const { cpu, irqController, cpuExecution, state } = makeCompiledIrqRuntime(source);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irqController.raise(IRQ_VBLANK);
	assert.equal(cpuExecution.runHaltedUntilIrq(state), false);
	cpuExecution.runWithBudget(state);
	assert.equal((cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('irq_seen'))) as number) > 1, true);
	assert.equal((irqController.captureState().pendingFlags & IRQ_VBLANK) !== 0, true);
});

test('IRQ_MASK accepts pending IRQ at the next guest instruction boundary', () => {
	const source = `
local irq_ack_addr<const> = 0x0800010c
local irq_mask_addr<const> = 0x08000110
local irq_vblank<const> = 0x0010
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
	const moduleCache = new Map<string, Value>();
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	runtime.machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	const state = {
		haltGame: false,
		updateExecuted: false,
		luaFaulted: false,
		cycleBudgetRemaining: 100,
		cycleBudgetGranted: 100,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
	};
	runtime.cpuExecution.runHaltedUntilIrq(state);
	assert.deepEqual(cpu.getCallStack().map(frame => frame.protoIndex), [0, 1]);

	const snapshot = cpu.captureRuntimeState(moduleCache);
	cpu.restoreRuntimeState(snapshot, moduleCache);
	assert.deepEqual(cpu.getCallStack().map(frame => frame.protoIndex), [0, 1]);
	assert.equal(cpu.canAcceptMaskableInterruptLine(runtime.machine.irqController), false);

	runtime.machine.irqController.acknowledge(IRQ_VBLANK);
	runtime.cpuExecution.runWithBudget(state);
	assert.equal(cpu.getFrameDepth(), 0);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	assert.equal(cpu.canAcceptMaskableInterruptLine(runtime.machine.irqController), true);
});


test('frame scheduler does not burn active CPU budget while halted for IRQ without host time', () => {
	const runtime = makeHaltFrameRuntime();
	runtime.frameScheduler = new FrameSchedulerState(runtime);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);
	assert.equal(runtime.machine.cpu.isHaltedUntilIrq(), true);
	const remaining = runtime.frameLoop.currentFrameState!.cycleBudgetRemaining;

	runtime.frameScheduler.run(0);

	assert.equal(runtime.frameLoop.currentFrameState!.cycleBudgetRemaining, remaining);
	assert.equal(runtime.machine.cpu.isHaltedUntilIrq(), true);
});

test('IRQ state restore preserves asserted line and cart-visible flags', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);

	memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	irq.raise(IRQ_VBLANK);
	const state = irq.captureState();
	irq.reset();

	assert.equal(irq.hasAssertedMaskableInterruptLine(), false);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS), 0);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0);

	irq.restoreState(state);

	assert.equal(irq.hasAssertedMaskableInterruptLine(), true);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
	assert.equal(memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
});

test('Machine full-state restore preserves asserted IRQ line and cart-visible flags', () => {
	const machine = makeMachine();

	machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	machine.irqController.raise(IRQ_VBLANK);
	const state = captureMachineState(machine);
	machine.irqController.reset();

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), false);
	assert.equal(machine.memory.readIoU32(IO_IRQ_FLAGS), 0);
	assert.equal(machine.memory.readIoU32(IO_IRQ_MASK), 0);

	restoreMachineState(machine, state);

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), true);
	assert.equal((machine.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
	assert.equal(machine.memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
});

test('Machine save-state restore preserves asserted IRQ line and cart-visible flags', () => {
	const machine = makeMachine();

	machine.memory.writeValue(IO_IRQ_MASK, IRQ_VBLANK);
	machine.irqController.raise(IRQ_VBLANK);
	const state = captureMachineSaveState(machine);
	machine.irqController.reset();

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), false);
	assert.equal(machine.memory.readIoU32(IO_IRQ_FLAGS), 0);
	assert.equal(machine.memory.readIoU32(IO_IRQ_MASK), 0);

	restoreMachineSaveState(machine, state);

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), true);
	assert.equal((machine.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
	assert.equal(machine.memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
});
