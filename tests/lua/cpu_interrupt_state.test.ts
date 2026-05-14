import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcceptedInterruptKind, CPU, createNativeFunction, OpCode, RunResult, type Program, type ProgramMetadata, type Proto, type Value } from '../../src/bmsx/machine/cpu/cpu';
import { writeInstruction, INSTRUCTION_BYTES } from '../../src/bmsx/machine/cpu/instruction_format';
import { BASE_CYCLES } from '../../src/bmsx/machine/cpu/opcode_info';
import { IO_IRQ_FLAGS, IRQ_VBLANK } from '../../src/bmsx/machine/bus/io';
import { IrqController } from '../../src/bmsx/machine/devices/irq/controller';
import { Machine } from '../../src/bmsx/machine/machine';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { callClosureInto, callClosureIntoWithScheduler } from '../../src/bmsx/machine/program/executor';
import { CpuExecutionState } from '../../src/bmsx/machine/runtime/cpu_executor';
import type { Runtime } from '../../src/bmsx/machine/runtime/runtime';

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
		globalNames: [],
		systemGlobalNames: [],
	};
}

function makeProgram(cpu: CPU): Program {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 0, 0, 0);
	const pool = cpu.stringPool;
	return {
		code,
		constPool: [],
		protos: [makeProto(INSTRUCTION_BYTES), { ...makeProto(INSTRUCTION_BYTES), entryPC: INSTRUCTION_BYTES }],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

function makeThrowingNativeProgram(cpu: CPU, nativeFunction: Value): Program {
	const code = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CALL, 0, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(code, 3, OpCode.RET, 0, 0, 0, 0);
	const pool = cpu.stringPool;
	return {
		code,
		constPool: [nativeFunction],
		protos: [makeProto(3 * INSTRUCTION_BYTES), { ...makeProto(INSTRUCTION_BYTES), entryPC: 3 * INSTRUCTION_BYTES }],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

function makeRuntime(cpu: CPU, sliceStats?: { begin: number; end: number }): Runtime {
	return {
		machine: {
			cpu,
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
	const soundMaster = {
		addEndedListener: () => () => {},
		stopAllVoices: () => {},
	};
	const machine = new Machine(
		memory,
		{ x: 256, y: 212 },
		input as never,
		soundMaster as never,
	);
	machine.initializeSystemIo();
	machine.resetDevices();
	return machine;
}

test('CPU host calls cannot wake HALT without an accepted interrupt', () => {
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

test('CPU host calls rejected while already halted preserve budget state', () => {
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

test('CPU host calls that execute HALT before returning throw and unwind', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(1);
	const runtime = makeRuntime(cpu);

	assert.throws(
		() => callClosureIntoWithScheduler(runtime, { protoIndex: 0, upvalues: [] }, [], []),
		/Lua host call halted before returning/,
	);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.getFrameDepth(), 1);
});

test('CPU host calls that throw after executing preserve spent budget', () => {
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

test('CPU accepts NMI before maskable IRQ and preserves explicit maskable state', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.start(0);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	irq.raise(IRQ_VBLANK);
	cpu.requestNonMaskableInterrupt();

	assert.equal(cpu.acceptPendingInterrupt(irq), AcceptedInterruptKind.NonMaskable);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	cpu.haltUntilIrq();
	assert.equal(cpu.acceptPendingInterrupt(irq), AcceptedInterruptKind.None);
	cpu.restoreMaskableInterruptsAfterNonMaskableInterrupt();
	assert.equal(cpu.acceptPendingInterrupt(irq), AcceptedInterruptKind.Maskable);
});

test('IRQ state restore preserves asserted line and cart-visible flags', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const irq = new IrqController(memory);

	irq.raise(IRQ_VBLANK);
	const state = irq.captureState();
	irq.reset();

	assert.equal(irq.hasAssertedMaskableInterruptLine(), false);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS), 0);

	irq.restoreState(state);

	assert.equal(irq.hasAssertedMaskableInterruptLine(), true);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
});

test('Machine full-state restore preserves asserted IRQ line and cart-visible flags', () => {
	const machine = makeMachine();

	machine.irqController.raise(IRQ_VBLANK);
	const state = machine.captureState();
	machine.irqController.reset();

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), false);
	assert.equal(machine.memory.readIoU32(IO_IRQ_FLAGS), 0);

	machine.restoreState(state);

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), true);
	assert.equal((machine.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
});

test('Machine save-state restore preserves asserted IRQ line and cart-visible flags', () => {
	const machine = makeMachine();

	machine.irqController.raise(IRQ_VBLANK);
	const state = machine.captureSaveState();
	machine.irqController.reset();

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), false);
	assert.equal(machine.memory.readIoU32(IO_IRQ_FLAGS), 0);

	machine.restoreSaveState(state);

	assert.equal(machine.irqController.hasAssertedMaskableInterruptLine(), true);
	assert.equal((machine.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_VBLANK) !== 0, true);
});
