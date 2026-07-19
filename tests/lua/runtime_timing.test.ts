import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_APU_CMD,
	IO_APU_GAIN_Q12,
	IO_APU_GENERATOR_DUTY_Q12,
	IO_APU_GENERATOR_KIND,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SLOT,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_GX_GPU_GP1,
} from '../../machine/ts/machine/bus/io';
import {
	APU_CMD_PLAY,
	APU_GAIN_Q12_ONE,
	APU_GENERATOR_SQUARE,
	APU_RATE_STEP_Q16_ONE,
} from '../../machine/ts/machine/devices/audio/contracts';
import {
	GX_GPU_GP1_DISPLAY_MODE,
	GX_GPU_GP1_VERTICAL_DISPLAY_RANGE,
} from '../../machine/ts/machine/devices/gx/gpu';
import {
	GX_GPU_PCRTC_CSR_HSINT,
	GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES,
	GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
	GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END,
	GX_GPU_PCRTC_SMODE1_HIGH,
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	GX_GPU_PCRTC_SYNCH1_HIGH,
	GX_GPU_PCRTC_SYNCH1_LOW,
	GX_GPU_PCRTC_SYNCH2_HIGH,
	GX_GPU_PCRTC_SYNCH2_LOW,
	GX_GPU_PCRTC_SYNCV_HIGH,
	GX_GPU_PCRTC_SYNCV_LOW,
	GxGpuPcrtc,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import { runDueRuntimeTimers } from '../../machine/ts/machine/runtime/cpu_executor';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import { applyRuntimeMachineState, captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	DEVICE_SERVICE_APU,
	DEVICE_SERVICE_APU_TRANSFER,
} from '../../machine/ts/machine/scheduler/device';
import { FrameSchedulerState } from '../../machine/ts/machine/scheduler/frame';

const PCRTC_SYNCH2_SLOW_WORD = 0x004f84bc;
const PCRTC_SYNCV_192_LINE_FIELD_WORD = 0x00a60005;

class TimingInputSource implements RuntimeInputSource {
	public frameDurationMs = 0;

	public setRuntimeInputFrameDurationMs(frameDurationMs: number): void {
		this.frameDurationMs = frameDurationMs;
	}

	public sampleInputControllerSnapshot(): void {
	}

	public supervisorRequestLineHigh(): boolean {
		return false;
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

function createTimingRuntime(cpuHz = 5_000_000): Runtime {
	const timing = resolveRuntimeTiming(cpuHz);
	return new Runtime({
		memory: new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }),
		pcrtcRunning: timing.pcrtcRunning,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		totalHalfLines: timing.totalHalfLines,
		activeDisplayHalfLines: timing.activeDisplayHalfLines,
		dmaWordsPerSec: timing.dmaWordsPerSec,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new TimingInputSource());
}

function cancelAudioServices(runtime: Runtime): void {
	runtime.machine.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	runtime.machine.scheduler.cancelDeviceService(DEVICE_SERVICE_APU_TRANSFER);
}

function runDueAt(runtime: Runtime, cycle: number): boolean {
	runtime.machine.scheduler.advanceTo(cycle);
	return runDueRuntimeTimers(runtime);
}

function configureOneHalfLineField(pcrtc: GxGpuPcrtc, syncvHigh: number): void {
	pcrtc.reset(0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, 0x00000009, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_LOW, 1, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_LOW, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_LOW, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_HIGH, syncvHigh, 0);
	pcrtc.setCpuHz(5_000_000, 0);
}

test('runtime boot timing is decoded from the exact PCRTC reset mode', () => {
	const timing = resolveRuntimeTiming(5_000_000);
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);

	assert.equal(timing.pcrtcRunning, true);
	assert.equal(timing.ufpsScaled, GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
	assert.equal(timing.totalHalfLines, GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES);
	assert.equal(timing.activeDisplayHalfLines, GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES);
	assert.equal(timing.cycleBudgetPerFrame, 100_480);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 100_480);
	assert.equal(runtime.machine.scheduler.nextDeadline(), 320);
});

test('PCRTC SINT stops only the beam and release starts a fresh line epoch', () => {
	const pcrtc = new GxGpuPcrtc();
	pcrtc.reset(0);
	pcrtc.setCpuHz(5_000_000, 0);
	const runningSMode1 = pcrtc.readRegisterWord(GX_GPU_PCRTC_SMODE1_LOW);

	assert.equal(pcrtc.nextDeadlineCycle(), 320);
	pcrtc.service(320);
	assert.notEqual(pcrtc.readCsr() & GX_GPU_PCRTC_CSR_HSINT, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, runningSMode1 | GX_GPU_PCRTC_SMODE1_SINT, 320);
	pcrtc.writeCsr(GX_GPU_PCRTC_CSR_HSINT, 320);
	assert.equal(pcrtc.nextDeadlineCycle(), -1);

	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, runningSMode1, 500);
	assert.equal(pcrtc.nextDeadlineCycle(), 820);
});

test('PCRTC accepts cycle zero and coalesces sub-cycle fields into one runtime edge', () => {
	const pcrtc = new GxGpuPcrtc();
	configureOneHalfLineField(pcrtc, 1 << 21);

	assert.equal(pcrtc.timing.totalHalfLines, 1);
	assert.equal(pcrtc.timing.activeDisplayHalfLines, 0);
	assert.equal(pcrtc.nextDeadlineCycle(), 0);
	assert.equal(pcrtc.service(0) & GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN, GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN);
	assert.equal(pcrtc.nextDeadlineCycle(), 1);
	assert.equal(pcrtc.service(1) & GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN, GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN);
	assert.equal(pcrtc.nextDeadlineCycle(), 2);
	assert.equal(pcrtc.field(), 1);
});

test('PCRTC advances exact raw half-lines beyond the double product precision boundary', () => {
	const pcrtc = new GxGpuPcrtc();
	pcrtc.reset(0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_LOW, 0x0000082f, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SMODE1_HIGH, 0x00000010, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_LOW, 0x000ed724, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH1_HIGH, 0x07b4c800, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_LOW, 0x07d79334, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCH2_HIGH, 0, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_LOW, 0xc1611944, 0);
	pcrtc.writeConfigWord(GX_GPU_PCRTC_SYNCV_HIGH, 0x40661ece, 0);
	pcrtc.setCpuHz(50_000_000, 0);

	for (const deadline of [2_029_892, 793_687_425, 1_593_464_523]) {
		assert.equal(pcrtc.nextDeadlineCycle(), deadline);
		pcrtc.service(deadline);
	}
	assert.equal(pcrtc.nextDeadlineCycle(), 10_376_803_360);
	assert.equal(pcrtc.currentHalfLine(10_376_803_359), 10_223);
	assert.equal(pcrtc.currentHalfLine(10_376_803_360), 10_224);
	assert.notEqual(pcrtc.service(10_376_803_360) & GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END, 0);
	const state = pcrtc.captureState(10_376_803_360);
	assert.equal(state.beamCycleOffset, 0);
	assert.equal(state.beamRemainder, 0);
	assert.equal(state.beamHalfLine, 0);
});

test('runtime publishes live PCRTC timing immediately and latches presentation words at VBlank', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCH2_LOW);

	runtime.machine.memory.writeMappedU32LE(address, PCRTC_SYNCH2_SLOW_WORD);
	assert.equal(runtime.timing.ufpsScaled, GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED);
	runDueRuntimeTimers(runtime);
	assert.equal(runtime.timing.ufpsScaled, 39_808_917);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 125_600);
	let pcrtcState = captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc;
	assert.equal(pcrtcState.registerWords[GX_GPU_PCRTC_SYNCH2_LOW], PCRTC_SYNCH2_SLOW_WORD);
	assert.notEqual(pcrtcState.presentWords[GX_GPU_PCRTC_SYNCH2_LOW], PCRTC_SYNCH2_SLOW_WORD);

	runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
	runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
	pcrtcState = captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc;
	assert.equal(pcrtcState.presentWords[GX_GPU_PCRTC_SYNCH2_LOW], PCRTC_SYNCH2_SLOW_WORD);
});

test('legacy GP1 display words cannot drive the PCRTC clock', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const deadline = runtime.machine.scheduler.nextDeadline();
	const revision = runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming.revision;

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_DISPLAY_MODE << 24);
	runtime.machine.memory.writeMappedU32LE(
		IO_GX_GPU_GP1,
		(GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | 0x00038020,
	);

	assert.equal(runtime.machine.gxGpu.readDisplayModeWord(), 0);
	assert.equal(runtime.machine.gxGpu.readVerticalDisplayRangeWord(), 0x00038020);
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming.revision, revision);
	assert.equal(runtime.machine.scheduler.nextDeadline(), deadline);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 100_480);
});

test('runtime restore preserves physical beam phase and a pending presentation timing write', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_HIGH);
	runtime.machine.memory.writeMappedU32LE(address, PCRTC_SYNCV_192_LINE_FIELD_WORD);
	runDueRuntimeTimers(runtime);
	assert.equal(runtime.timing.activeDisplayHalfLines, 384);
	const pendingState = captureRuntimeMachineState(runtime);
	const pendingDeadline = runtime.machine.scheduler.nextDeadline();

	runDueAt(runtime, pendingDeadline);
	runDueAt(runtime, runtime.machine.scheduler.nextDeadline());
	assert.equal(
		captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc.presentWords[GX_GPU_PCRTC_SYNCV_HIGH],
		PCRTC_SYNCV_192_LINE_FIELD_WORD,
	);

	applyRuntimeMachineState(runtime, pendingState);
	const restoredPcrtc = captureRuntimeMachineState(runtime).machine.gxGpu.pcrtc;
	assert.equal(restoredPcrtc.registerWords[GX_GPU_PCRTC_SYNCV_HIGH], PCRTC_SYNCV_192_LINE_FIELD_WORD);
	assert.notEqual(restoredPcrtc.presentWords[GX_GPU_PCRTC_SYNCV_HIGH], PCRTC_SYNCV_192_LINE_FIELD_WORD);
	assert.equal(runtime.timing.activeDisplayHalfLines, 384);
	assert.equal(runtime.machine.scheduler.nextDeadline(), pendingDeadline);
});

test('runtime restore preserves an in-flight frame budget and resets only its host clock', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	runtime.frameLoop.beginFrameState(23_456, 34_567);
	const active = runtime.frameLoop.frameState;
	active.updateExecuted = true;
	active.luaFaulted = true;
	active.cycleBudgetRemaining = 12_345;
	active.activeCpuUsedCycles = 45_678;
	runtime.frameLoop.frameDeltaMs = 20.096;
	runtime.frameLoop.currentTimeMs = 987.5;
	const snapshot = captureRuntimeMachineState(runtime);

	runtime.frameLoop.frameActive = false;
	active.updateExecuted = false;
	active.luaFaulted = false;
	active.cycleBudgetRemaining = 99;
	active.cycleBudgetGranted = 98;
	active.cycleCarryGranted = 97;
	active.activeCpuUsedCycles = 96;
	runtime.frameLoop.frameDeltaMs = 1;
	runtime.frameLoop.currentTimeMs = 2;
	applyRuntimeMachineState(runtime, snapshot);

	assert.deepEqual(runtime.frameLoop.captureState(), snapshot.frameLoop);
	assert.equal(runtime.frameLoop.currentTimeMs, 0);
	assert.equal(runtime.vblank.tickCompleted, false);
});

test('host machine-cycle grants remain exact while PCRTC is stopped', () => {
	const grants: number[] = [];
	let scheduler!: FrameSchedulerState;
	const frameState = {
		cycleBudgetRemaining: 0,
		cycleBudgetGranted: 0,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
	};
	const frameLoop = {
		frameActive: false,
		frameState,
		beginFrameState(budget: number, carry: number): void {
			this.frameActive = true;
			frameState.cycleBudgetRemaining = budget;
			frameState.cycleBudgetGranted = budget;
			frameState.cycleCarryGranted = carry;
		},
		tickUpdate(): boolean {
			if (!this.frameActive && !scheduler.startScheduledFrame()) return false;
			grants.push(frameState.cycleBudgetRemaining);
			this.frameActive = false;
			return true;
		},
	};
	const runtime = {
		timing: { cpuHz: 5_000_000, pcrtcRunning: false },
		luaInitialized: true,
		luaRuntimeFailed: false,
		machine: {
			gxGpu: {
				backendReadbackBlocksMachine: () => false,
				lastFrameCommitted: () => false,
			},
		},
		frameLoop,
	} as unknown as Runtime;
	scheduler = new FrameSchedulerState(runtime);
	(runtime as unknown as { frameScheduler: FrameSchedulerState }).frameScheduler = scheduler;

	scheduler.run(50);
	assert.deepEqual(grants, [83_333, 83_333, 83_334]);
	assert.equal(grants[0]! + grants[1]! + grants[2]!, 250_000);
});

test('stopped PCRTC has no video deadline and hardware reset restores the exact beam', () => {
	const runtime = createTimingRuntime();
	cancelAudioServices(runtime);
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	const runningWord = runtime.machine.memory.readMappedU32LE(address);
	runtime.machine.memory.writeMappedU32LE(address, runningWord | GX_GPU_PCRTC_SMODE1_SINT);
	runDueRuntimeTimers(runtime);

	assert.equal(runtime.timing.pcrtcRunning, false);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 0);
	assert.equal(runtime.machine.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);

	runtime.resetHardwareState();
	cancelAudioServices(runtime);
	assert.equal(runtime.timing.pcrtcRunning, true);
	assert.equal(runtime.timing.cycleBudgetPerFrame, 100_480);
	assert.equal(runtime.machine.scheduler.nextDeadline(), 320);
});

test('PCRTC retains frame cycle budgets above a signed 32-bit CPU slice', () => {
	const pcrtc = new GxGpuPcrtc();
	pcrtc.reset(0);
	pcrtc.setCpuHz(110_000_000_000, 0);
	assert.ok(pcrtc.timing.nextVblankCycleBudget > 0x7fffffff);
});

test('VBlank reset and runtime restore preserve the active APU clock domain', () => {
	const runtime = createTimingRuntime();
	const memory = runtime.machine.memory;
	memory.writeMappedU32LE(IO_APU_SOURCE_SAMPLE_RATE_HZ, runtime.timing.cpuHz);
	memory.writeMappedU32LE(IO_APU_SOURCE_CHANNELS, 1);
	memory.writeMappedU32LE(IO_APU_SOURCE_FRAME_COUNT, 2);
	memory.writeMappedU32LE(IO_APU_SOURCE_LOOP_END_SAMPLE, 2);
	memory.writeMappedU32LE(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
	memory.writeMappedU32LE(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
	memory.writeMappedU32LE(IO_APU_GENERATOR_KIND, APU_GENERATOR_SQUARE);
	memory.writeMappedU32LE(IO_APU_GENERATOR_DUTY_Q12, 0x0800);
	memory.writeMappedU32LE(IO_APU_SLOT, 1);
	memory.writeMappedU32LE(IO_APU_CMD, APU_CMD_PLAY);
	runtime.machine.audioController.onService(0);

	runtime.machine.scheduler.advanceTo(100_000);
	runtime.machine.audioController.onService(100_000);
	runtime.machine.audioOutput.outputRing.clear();
	runtime.vblank.reset();
	assert.equal(runtime.machine.scheduler.nowCycles, 100_000);
	runtime.machine.scheduler.advanceTo(100_114);
	runtime.machine.audioController.onService(100_114);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 1);

	const state = captureRuntimeMachineState(runtime);
	runtime.machine.scheduler.advanceTo(200_000);
	runtime.machine.audioController.onService(200_000);
	runtime.machine.audioOutput.outputRing.clear();
	applyRuntimeMachineState(runtime, state);
	assert.equal(runtime.machine.scheduler.nowCycles, 100_114);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 0);
	runtime.machine.scheduler.advanceTo(100_228);
	runtime.machine.audioController.onService(100_228);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 1);

	runtime.resetHardwareState();
	assert.equal(runtime.machine.scheduler.nowCycles, 0);
	assert.equal(runtime.machine.audioOutput.outputRing.queuedFrames(), 0);
});
