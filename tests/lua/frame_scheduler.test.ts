import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcceptedInterruptKind } from '../../machine/ts/machine/cpu/cpu';
import type {
	InputControllerInputSource,
	InputControllerSnapshot,
} from '../../machine/ts/machine/devices/input/contracts';
import { runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode, HistorySeekResult } from '../../machine/ts/machine/runtime/history/history';
import {
	INP_CTRL_ARM,
	IO_INP_CTRL,
	IO_INP_KEYS,
	IO_INP_STATUS,
	IO_IRQ_FLAGS,
	IO_IRQ_MASK,
	IO_SYS_CONTROL,
	IRQ_VBLANK,
	SYS_CONTROL_RESET,
} from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	PSX_CPU_FREQ_HZ,
	PSX_MACHINE_SPEC,
} from '../../machine/ts/spec/bmsx/model';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { GX_GPU_GP0_VRAM_TO_CPU_FIRST } from '../../machine/ts/spec/gx/gp0';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/spec/gx/pcrtc';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';

const TEST_KEY_USAGE = 59;

class TickInputSource implements InputControllerInputSource {
	public sampleCount = 0;
	public keyDown = false;
	public supervisorHigh = false;
	public rejectLiveInput = false;

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		assert.equal(this.rejectLiveInput, false);
		this.sampleCount += 1;
		if (this.keyDown) {
			snapshot.keyWords[TEST_KEY_USAGE >>> 5] |= 1 << (TEST_KEY_USAGE & 31);
		}
	}

	public supervisorRequestLineHigh(): boolean {
		assert.equal(this.rejectLiveInput, false);
		return this.supervisorHigh;
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

test('history checkpoint pressure suspends machine time before required input can be overwritten', () => {
	const { runtime } = createTickRuntime();
	const history = runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 2, checkpointIntervalCycles: 0x100000000 });
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), false);
	assert.equal(runtime.machine.scheduler.nowCycles, 0);
	history.captureCheckpoint();
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), true);
	const firstCycles = runtime.machine.scheduler.nowCycles;
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), true);
	assert.equal(history.checkpointPending, true);
	const secondCycles = runtime.machine.scheduler.nowCycles;
	runtime.frameScheduler.run(80);
	assert.equal(runtime.machine.scheduler.nowCycles, secondCycles);
	assert.equal(history.inputJournal.endSequence, 2);
	history.captureCheckpoint();
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), true);
	assert.equal(history.checkpointCount, 1, 'only checkpoints with retained input remain');
	assert.equal(history.earliestCycles, secondCycles);
	history.beginSeek(firstCycles);
	assert.equal(history.targetCycles, secondCycles, 'user seek is bounded by the retained range');
	assert.equal(history.mode, HistoryMode.Reviewing);
	runtime.frameScheduler.run(80);
	assert.equal(runtime.machine.scheduler.nowCycles, secondCycles);
	assert.equal(history.advanceSeek(100), HistorySeekResult.Complete);
	history.resumeRecording();
	assert.equal(history.checkpointPending, true);
	assert.equal(history.inputJournal.endSequence, 2, 'live takeover truncates future input');
	history.captureCheckpoint();
	runtime.rebootSystem();
	assert.equal(history.mode, HistoryMode.Disabled);
	assert.equal(history.checkpointCount, 0);
	assert.equal(history.inputJournal.storageBytes, 0);
});

test('history replays an unarmed supervisor edge through the actual ICU without reading live input', () => {
	const { runtime, input } = createTickRuntime();
	const gpu = runtime.machine.gxGpu;
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const serviceBackend = (): void => {
		while (gpu.backendServicePending()) {
			if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
			else backend.executeGxGpuReadback(gpu);
		}
		backend.executeGxGpuCommandDrain(gpu);
		gpu.retirePresentedCommands();
	};
	const history = runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 0x100000000 });
	backend.captureGxGpuVramSnapshot(gpu);
	history.captureCheckpoint();
	// This minimal ROM has no monitor firmware. Compare at the request edge,
	// before supervisor firmware would reprogram the quiesced PCRTC.
	for (let tick = 0; tick < 2; tick += 1) {
		input.supervisorHigh = tick === 1;
		let completed = runtime.frameScheduler.runToNextLogicalTick();
		for (let attempt = 0; !completed && attempt < 32; attempt += 1) {
			serviceBackend();
			completed = runtime.frameScheduler.runToNextLogicalTick();
		}
		assert.equal(completed, true);
		serviceBackend();
	}
	assert.equal(input.sampleCount, 0, 'the ICU was never armed');
	assert.equal(history.inputJournal.flagsAt(1), 4, 'the unarmed NMI line is still recorded');
	const expectedCycles = runtime.machine.scheduler.nowCycles;
	const expectedInput = runtime.machine.inputController.captureState();
	const expectedSystem = runtime.machine.systemController.captureState();
	const expectedIrq = runtime.machine.irqController.captureState();
	input.rejectLiveInput = true;
	history.beginSeek(expectedCycles);
	let steps = 0;
	while (history.mode === HistoryMode.Replaying && steps++ < 1000) {
		assert.notEqual(history.advanceSeek(16384), HistorySeekResult.Stopped);
		serviceBackend();
	}
	assert.equal(history.mode, HistoryMode.Reviewing);
	assert.equal(runtime.machine.scheduler.nowCycles, expectedCycles);
	assert.deepEqual(runtime.machine.inputController.captureState(), expectedInput);
	assert.deepEqual(runtime.machine.systemController.captureState(), expectedSystem);
	assert.deepEqual(runtime.machine.irqController.captureState(), expectedIrq);
});

test('cancelled replay preserves future until takeover and discards its partial scheduling grant on takeover', () => {
	const { runtime } = createTickRuntime();
	const history = runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 0x100000000 });
	history.captureCheckpoint();
	for (let tick = 0; tick < 3; tick += 1) runtime.frameScheduler.runToNextLogicalTick();
	const end = history.latestCycles;
	history.beginSeek(end);
	assert.equal(history.advanceSeek(256), HistorySeekResult.Progressed);
	assert.equal(runtime.frameScheduler.captureState().logicalTickRunPending, true);
	history.cancelSeek();
	const cancelledCycles = runtime.machine.scheduler.nowCycles;
	runtime.frameScheduler.run(80);
	assert.equal(runtime.machine.scheduler.nowCycles, cancelledCycles);
	assert.equal(history.latestCycles, end);
	assert.equal(history.inputJournal.endSequence, 3);
	history.resumeRecording();
	assert.equal(history.inputJournal.endSequence, 0);
	assert.equal(runtime.frameScheduler.captureState().logicalTickRunPending, false);
	history.captureCheckpoint();
	runtime.frameScheduler.run(runtime.timing.frameDurationMs * 2);
	const before = runtime.frameScheduler.lastTickSequence;
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), true);
	assert.equal(runtime.frameScheduler.lastTickSequence, before + 1, 'no replay target remains in the live scheduler');
});

test('history seek yields while a submitted backend readback is awaiting completion', () => {
	const { runtime } = createTickRuntime();
	const gpu = runtime.machine.gxGpu;
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	const history = runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 0x100000000 });
	history.captureCheckpoint();
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), false);
	const output = gpu.readDeviceOutput();
	assert.equal(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), true);
	output.readbackPort.completeReadback(output.readbackPort.token);
	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), true);
	history.beginSeek(history.latestCycles);
	assert.equal(history.advanceSeek(16384), HistorySeekResult.BackendPending);
	assert.equal(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), true);
	const cycles = runtime.machine.scheduler.nowCycles;
	const grant = runtime.frameLoop.frameState.cycleBudgetGranted;
	assert.equal(gpu.backendServicePending(), false, 'the request has already been submitted');
	assert.equal(history.advanceSeek(16384), HistorySeekResult.BackendPending);
	assert.equal(runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(runtime.frameLoop.frameState.cycleBudgetGranted, grant);
	output.readbackPort.completeReadback(output.readbackPort.token);
	for (let step = 0; history.mode === HistoryMode.Replaying && step < 100; step += 1) {
		assert.notEqual(history.advanceSeek(16384), HistorySeekResult.Stopped);
	}
	assert.equal(history.mode, HistoryMode.Reviewing);
});

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

test('bounded logical-tick execution resumes a backend fence without granting another period', () => {
	const { runtime } = createTickRuntime();
	const scheduler = runtime.frameScheduler;
	const gpu = runtime.machine.gxGpu;
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);

	assert.equal(scheduler.runToNextLogicalTick(), false);
	assert.equal(gpu.backendServiceBlocksMachine(), true);
	assert.equal(scheduler.lastTickSequence, 0);
	assert.equal(runtime.frameLoop.frameState.cycleBudgetGranted, runtime.timing.cycleBudgetPerFrame);
	const suspendedState = scheduler.captureState();
	assert.equal(suspendedState.logicalTickRunPending, true);
	assert.equal(suspendedState.logicalTickRunTargetSequence, 1);

	const output = gpu.readDeviceOutput();
	const readback = output.readbackPort;
	assert.equal(readback.claimReadback(output.commandBuffer.executedCommandCount), true);
	readback.completeReadback(readback.token);
	assert.equal(scheduler.runToNextLogicalTick(), true);
	assert.equal(scheduler.lastTickSequence, 1);
	assert.equal(scheduler.lastTickBudgetGranted, runtime.timing.cycleBudgetPerFrame);
	assert.equal(scheduler.captureState().logicalTickRunPending, false);
	assert.equal(scheduler.captureState().logicalTickRunTargetSequence, 0);
});

test('scheduled bounded execution waits for host time and retains partial machine progress', () => {
	const { runtime } = createTickRuntime();
	const scheduler = runtime.frameScheduler;
	const halfFrameMs = runtime.timing.frameDurationMs / 2;

	assert.equal(scheduler.runScheduledToNextLogicalTick(0), false);
	assert.equal(runtime.frameLoop.frameActive, false);
	assert.equal(scheduler.runScheduledToNextLogicalTick(halfFrameMs), false);
	assert.equal(scheduler.lastTickSequence, 0);
	assert.equal(runtime.frameLoop.frameActive, true);
	assert.equal(scheduler.runScheduledToNextLogicalTick(halfFrameMs), true);
	assert.equal(scheduler.lastTickSequence, 1);
	assert.equal(
		scheduler.lastTickBudgetGranted,
		Math.trunc(runtime.timing.frameDurationMs * runtime.timing.cpuCyclesPerMillisecond),
	);
});

test('scheduled bounded execution exposes every catch-up tick without adding host time', () => {
	const { input, runtime } = createTickRuntime();
	const scheduler = runtime.frameScheduler;
	const hostDeltaMs = runtime.timing.frameDurationMs * 4;

	for (let expectedSequence = 1; expectedSequence <= 4; expectedSequence += 1) {
		input.keyDown = (expectedSequence & 1) !== 0;
		runtime.machine.memory.writeMappedU32LE(IO_INP_CTRL, INP_CTRL_ARM);
		assert.equal(
			scheduler.runScheduledToNextLogicalTick(expectedSequence === 1 ? hostDeltaMs : 0),
			true,
		);
		assert.equal(scheduler.lastTickSequence, expectedSequence);
	}
	assert.equal(input.sampleCount, 4);
	assert.equal(scheduler.runScheduledToNextLogicalTick(0), false);
});

test('scheduled bounded execution resumes a backend fence with the accepted host grant', () => {
	const { runtime } = createTickRuntime();
	const scheduler = runtime.frameScheduler;
	const gpu = runtime.machine.gxGpu;
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);

	assert.equal(
		scheduler.runScheduledToNextLogicalTick(runtime.timing.frameDurationMs),
		false,
	);
	assert.equal(gpu.backendServiceBlocksMachine(), true);
	const grantedBudget = runtime.frameLoop.frameState.cycleBudgetGranted;
	const output = gpu.readDeviceOutput();
	const readback = output.readbackPort;
	assert.equal(readback.claimReadback(output.commandBuffer.executedCommandCount), true);
	readback.completeReadback(readback.token);
	assert.equal(scheduler.runScheduledToNextLogicalTick(0), true);
	assert.equal(scheduler.lastTickSequence, 1);
	assert.equal(scheduler.lastTickBudgetGranted, grantedBudget);
});

test('scheduled bounded execution produces the same machine second at common host rates', () => {
	const rates = [60, 120, 144] as const;
	let expectedTickSequence = -1;
	let expectedMachineCycles = -1;
	for (const rate of rates) {
		const { runtime } = createTickRuntime();
		const scheduler = runtime.frameScheduler;
		for (let hostFrame = 0; hostFrame < rate; hostFrame += 1) {
			let completed = scheduler.runScheduledToNextLogicalTick(1000 / rate);
			while (completed) {
				completed = scheduler.runScheduledToNextLogicalTick(0);
			}
		}
		if (expectedTickSequence < 0) {
			expectedTickSequence = scheduler.lastTickSequence;
			expectedMachineCycles = runtime.machine.scheduler.nowCycles;
		} else {
			assert.equal(scheduler.lastTickSequence, expectedTickSequence);
			assert.equal(runtime.machine.scheduler.nowCycles, expectedMachineCycles);
		}
	}
	assert.equal(expectedTickSequence, 49);
	assert.equal(expectedMachineCycles, PSX_CPU_FREQ_HZ);
});

test('bounded logical-tick execution extends an exhausted retained grant', () => {
	const { runtime } = createTickRuntime();
	const scheduler = runtime.frameScheduler;
	runtime.frameLoop.beginFrameState(0, 0);
	const pendingState = scheduler.captureState();
	pendingState.logicalTickRunPending = true;
	pendingState.logicalTickRunTargetSequence = 1;
	scheduler.restoreState(pendingState);

	assert.equal(scheduler.runToNextLogicalTick(), true);
	assert.equal(scheduler.lastTickSequence, 1);
	assert.equal(scheduler.lastTickBudgetGranted, runtime.timing.cycleBudgetPerFrame);
	assert.equal(scheduler.captureState().logicalTickRunPending, false);
});

test('bounded logical-tick execution does not report a reset as its target edge', () => {
	const { runtime } = createTickRuntime();
	runtime.machine.memory.writeMappedU32LE(IO_SYS_CONTROL, SYS_CONTROL_RESET);

	assert.equal(runtime.frameScheduler.runToNextLogicalTick(), false);
	assert.equal(runtime.frameScheduler.lastTickSequence, 0);
	assert.equal(runtime.frameScheduler.captureState().logicalTickRunPending, false);
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
