import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';
import { PSX_GPU_DISPLAY_MODE_NTSC_WORD, PSX_GPU_DISPLAY_MODE_PAL_WORD, NTSC_REFRESH_UFPS_SCALED, getPsxGpuDisplayModeTimingForWord } from '../../machine/ts/machine/model_registry';
import { resolveVblankCycles } from '../../machine/ts/machine/runtime/timing';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import { GX_GPU_GP1_RESET, GX_GPU_GP1_DISPLAY_MODE, GX_GPU_GP1_VERTICAL_DISPLAY_RANGE, GX_GPU_STATUS_PAL_MODE } from '../../machine/ts/machine/devices/gx/gpu';
import { GX_GPU_RESET_DISPLAY_MODE_WORD, GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD } from '../../machine/ts/machine/devices/gx/gpu_display';
import { IO_GX_GPU_GP1 } from '../../machine/ts/machine/bus/io';
import { applyRuntimeMachineState, captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';

const GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD = ((35 + 192) << 10) | 35;
const GX_GPU_VERTICAL_DISPLAY_RANGE_212_WORD = ((35 + 212) << 10) | 35;

class TimingInputSource implements RuntimeInputSource {
	public frameDurationMs = 0;

	public setRuntimeInputFrameDurationMs(frameDurationMs: number): void {
		this.frameDurationMs = frameDurationMs;
	}

	public sampleInputControllerSnapshot(): void {
	}

	public applyInputControllerVibrationEffect(): void {
	}
}

function createTimingRuntime(): Runtime {
	const timing = resolveRuntimeTiming(5_000_000, GX_GPU_RESET_DISPLAY_MODE_WORD);
	return new Runtime({
		memory: new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }),
		psxGpuDisplayModeWord: timing.gpuDisplayModeWord,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		vblankCycles: timing.vblankCycles,
		dmaBytesPerSec: timing.dmaBytesPerSec,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new TimingInputSource());
}

test('VBLANK cycles use PSX PAL display-mode scanlines', () => {
	const timing = getPsxGpuDisplayModeTimingForWord(PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal(timing.totalScanlines, 313);
	assert.equal(resolveVblankCycles(5_000_000, 50 * HZ_SCALE, timing.totalScanlines, 192), 38659);
});

test('VBLANK cycles use PSX NTSC display-mode scanlines', () => {
	const timing = getPsxGpuDisplayModeTimingForWord(PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal(timing.totalScanlines, 262);
	assert.equal(resolveVblankCycles(5_000_000, NTSC_REFRESH_UFPS_SCALED, timing.totalScanlines, 192), 22287);
});

test('runtime timing resolves from the PSX GPU display mode word', () => {
	const pal = resolveRuntimeTiming(5_000_000, PSX_GPU_DISPLAY_MODE_PAL_WORD);
	const ntsc = resolveRuntimeTiming(5_000_000, PSX_GPU_DISPLAY_MODE_NTSC_WORD);

	assert.equal(pal.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal(pal.ufpsScaled, 50 * HZ_SCALE);
	assert.equal(pal.totalScanlines, 313);
	assert.equal(pal.vblankCycles, 23323);
	assert.equal(ntsc.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal(ntsc.ufpsScaled, NTSC_REFRESH_UFPS_SCALED);
	assert.equal(ntsc.totalScanlines, 262);
	assert.equal(ntsc.vblankCycles, 7005);
	assert.equal(resolveVblankCycles(5_000_000, 50 * HZ_SCALE, 313, 212), 32269);
	assert.equal(resolveVblankCycles(5_000_000, NTSC_REFRESH_UFPS_SCALED, 262, 212), 15920);
});

test('runtime timing consumes published PSX GP1 display mode without shifting a late-serviced frame boundary', () => {
	const runtime = createTimingRuntime();
	const frameEndCycle = runtime.timing.cycleBudgetPerFrame;

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_DISPLAY_MODE << 24);

	assert.equal(runtime.machine.gxGpu.readDisplayModeWord(), PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal((runtime.machine.gxGpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().displayModeWord, GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal(runtime.timing.gpuDisplayModeWord, GX_GPU_RESET_DISPLAY_MODE_WORD);

	runtime.vblank.handleBeginTimer();
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().displayModeWord, PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal(runtime.timing.gpuDisplayModeWord, GX_GPU_RESET_DISPLAY_MODE_WORD);
	runtime.machine.scheduler.setNowCycles(frameEndCycle + 1);
	runtime.vblank.handleEndTimer();

	assert.equal(runtime.timing.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal(runtime.timing.ufpsScaled, NTSC_REFRESH_UFPS_SCALED);
	assert.equal(runtime.timing.totalScanlines, 262);
	assert.equal(runtime.machine.scheduler.nextDeadline(), frameEndCycle + 76411);
});

test('runtime timing consumes PSX GP1 reset back to PAL at the next frame boundary', () => {
	const runtime = createTimingRuntime();
	let frameEndCycle = runtime.timing.cycleBudgetPerFrame;

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_DISPLAY_MODE << 24);
	runtime.vblank.handleBeginTimer();
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	frameEndCycle += runtime.timing.cycleBudgetPerFrame;
	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_RESET << 24);

	assert.equal(runtime.machine.gxGpu.readDisplayModeWord(), GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal((runtime.machine.gxGpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal(runtime.timing.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	runtime.vblank.handleBeginTimer();
	assert.equal(runtime.timing.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	assert.equal(runtime.timing.gpuDisplayModeWord, GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal(runtime.timing.ufpsScaled, 50 * HZ_SCALE);
	assert.equal(runtime.timing.totalScanlines, 313);
});

test('runtime timing switches 240, 192, and 212 native display ranges only after publication', () => {
	const runtime = createTimingRuntime();
	let frameEndCycle = runtime.timing.cycleBudgetPerFrame;

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	assert.equal(runtime.machine.gxGpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().verticalDisplayRangeWord, GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD);
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD);
	runtime.vblank.handleBeginTimer();
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().verticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD);
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	assert.equal(runtime.machine.scheduler.nextDeadline(), frameEndCycle + 61341);

	frameEndCycle += runtime.timing.cycleBudgetPerFrame;
	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | GX_GPU_VERTICAL_DISPLAY_RANGE_212_WORD);
	runtime.vblank.handleBeginTimer();
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_212_WORD);
	assert.equal(runtime.machine.scheduler.nextDeadline(), frameEndCycle + 67731);

	frameEndCycle += runtime.timing.cycleBudgetPerFrame;
	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD);
	runtime.vblank.handleBeginTimer();
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD);
	assert.equal(runtime.machine.scheduler.nextDeadline(), frameEndCycle + 76677);
});

test('runtime restore derives timing from published display raw while preserving a pending range write', () => {
	const runtime = createTimingRuntime();
	let frameEndCycle = runtime.timing.cycleBudgetPerFrame;
	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	runtime.vblank.handleBeginTimer();
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | GX_GPU_VERTICAL_DISPLAY_RANGE_212_WORD);
	const state = captureRuntimeMachineState(runtime);

	frameEndCycle += runtime.timing.cycleBudgetPerFrame;
	runtime.vblank.handleBeginTimer();
	runtime.machine.scheduler.setNowCycles(frameEndCycle);
	runtime.vblank.handleEndTimer();
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_212_WORD);
	applyRuntimeMachineState(runtime, state);

	assert.equal(state.psxGpuDisplayModeWord, GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal(runtime.machine.gxGpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_212_WORD);
	assert.equal(runtime.machine.gxGpu.readDeviceOutput().verticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	assert.equal(runtime.timing.gpuVerticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_192_WORD);
	assert.equal(runtime.machine.scheduler.nextDeadline(), state.vblank.nowCycles + 61341);
});
