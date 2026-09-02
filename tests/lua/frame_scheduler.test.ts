import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcceptedInterruptKind } from '../../machine/ts/machine/cpu/cpu';
import type {
	InputControllerInputSource,
	InputControllerSnapshot,
} from '../../machine/ts/machine/devices/input/contracts';
import { runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	INP_CTRL_ARM,
	IO_INP_CTRL,
	IO_INP_KEYS,
	IO_INP_STATUS,
	IO_IRQ_FLAGS,
	IO_IRQ_MASK,
	IRQ_VBLANK,
} from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

const TEST_KEY_USAGE = 59;

class TickInputSource implements InputControllerInputSource {
	public sampleCount = 0;
	public keyDown = false;

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		this.sampleCount += 1;
		if (this.keyDown) {
			snapshot.keyWords[TEST_KEY_USAGE >>> 5] |= 1 << (TEST_KEY_USAGE & 31);
		}
	}

	public supervisorRequestLineHigh(): boolean {
		return false;
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

function createTickRuntime(input = new TickInputSource()): {
	input: TickInputSource;
	runtime: Runtime;
} {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RFE, 0, 0, 0, 0);
	const system = linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 1 },
			{ firstWord: 1, wordCount: 1 },
		],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const runtime = new Runtime({
		systemRomBytes: system.romBytes,
		cartridgeSlots: cartridgeSlots(),
		machineModel: PSX_MACHINE_SPEC,
	}, input);
	runtime.boot();
	return { input, runtime };
}

test('bounded logical-tick execution advances one VBlank sequence and retains cycle carry', () => {
	const { runtime } = createTickRuntime();
	const scheduler = runtime.frameScheduler;
	const partialDeltaMs = runtime.timing.frameDurationMs / 4;

	scheduler.run(partialDeltaMs);
	assert.equal(scheduler.lastTickSequence, 0);
	assert.equal(runtime.frameLoop.frameActive, true);
	const partialBudget = runtime.frameLoop.frameState.cycleBudgetGranted;
	const grantRemainder = scheduler.captureState().cycleGrantRemainder;
	const firstTickBudget = runtime.timing.cycleBudgetPerFrame;

	assert.equal(scheduler.runToNextLogicalTick(), true);
	assert.equal(scheduler.lastTickSequence, 1);
	assert.equal(scheduler.lastTickBudgetGranted, partialBudget + firstTickBudget);
	assert.equal(scheduler.captureState().cycleGrantRemainder, grantRemainder);
	assert.equal(
		scheduler.captureState().carriedCycleBudget,
		scheduler.lastTickBudgetRemaining,
	);
	const carriedBudget = scheduler.lastTickBudgetRemaining;

	assert.equal(scheduler.runToNextLogicalTick(), true);
	assert.equal(scheduler.lastTickSequence, 2);
	assert.equal(scheduler.lastTickBudgetGranted, carriedBudget + firstTickBudget);
	assert.equal(runtime.frameLoop.frameState.cycleCarryGranted, carriedBudget);
	assert.equal(scheduler.lastTickBudgetRemaining, carriedBudget);
	assert.equal(scheduler.captureState().cycleGrantRemainder, grantRemainder);
});

test('logical-tick boundary publishes ICU state and enters a waiting CPU interrupt', () => {
	const input = new TickInputSource();
	input.keyDown = true;
	const { runtime } = createTickRuntime(input);
	const memory = runtime.machine.memory;
	const frameDepth = runtime.machine.cpu.getFrameDepth();
	memory.writeMappedU32LE(IO_INP_CTRL, INP_CTRL_ARM);
	memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_VBLANK);

	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), true);

	assert.equal(input.sampleCount, 1);
	assert.equal(memory.readMappedU32LE(IO_INP_STATUS), 1);
	const keyWordAddress = IO_INP_KEYS + (TEST_KEY_USAGE >>> 5) * IO_WORD_SIZE;
	assert.notEqual(memory.readMappedU32LE(keyWordAddress) & (1 << (TEST_KEY_USAGE & 31)), 0);
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_VBLANK, 0);
	assert.equal(runtime.machine.cpu.peekPendingInterrupt(), AcceptedInterruptKind.None);
	assert.equal(runtime.machine.cpu.getFrameDepth(), frameDepth + 1);
});

test('logical-tick execution is bounded when PCRTC has no VBlank deadline', () => {
	const { runtime } = createTickRuntime();
	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	const smode1 = runtime.machine.memory.readMappedU32LE(smode1Address);
	runtime.machine.memory.writeMappedU32LE(
		smode1Address,
		smode1 | GX_GPU_PCRTC_SMODE1_SINT,
	);
	runDueRuntimeTimers(runtime);
	const cycle = runtime.machine.scheduler.nowCycles;

	assert.equal(runtime.timing.cycleBudgetPerFrame, 0);
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), false);
	assert.equal(runtime.frameScheduler.lastTickSequence, 0);
	assert.equal(runtime.machine.scheduler.nowCycles, cycle);
});

test('normal host execution still consumes one delta through the existing scheduler path', () => {
	const { runtime } = createTickRuntime();
	const exactHostGrant = runtime.timing.frameDurationMs
		* runtime.timing.cpuCyclesPerMillisecond;
	const wholeHostGrant = Math.trunc(exactHostGrant);

	runtime.frameScheduler.run(runtime.timing.frameDurationMs);

	assert.equal(runtime.frameScheduler.lastTickSequence, 1);
	assert.equal(runtime.machine.scheduler.nowCycles, wholeHostGrant);
	assert.equal(
		runtime.frameScheduler.captureState().cycleGrantRemainder,
		exactHostGrant - wholeHostGrant,
	);
});
