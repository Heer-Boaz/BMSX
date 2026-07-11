import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';
import { PSX_GPU_DISPLAY_MODE_NTSC_WORD, PSX_GPU_DISPLAY_MODE_PAL_WORD, NTSC_REFRESH_UFPS_SCALED, getPsxGpuDisplayModeTimingForWord } from '../../machine/ts/machine/model_registry';
import { resolveVblankCycles } from '../../machine/ts/machine/runtime/timing';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { Memory } from '../../machine/ts/machine/memory/memory';
import type { RuntimeInputSource } from '../../machine/ts/machine/runtime/input';
import type { MicrotaskQueue } from '../../machine/ts/machine/scheduler/microtask_queue';
import { GX_GPU_GP1_RESET, GX_GPU_GP1_SET_DISPLAY_MODE, GX_GPU_STATUS_PAL_MODE } from '../../machine/ts/machine/devices/gx/gpu';
import { IO_GX_GPU_GP1 } from '../../machine/ts/machine/bus/io';

const INLINE_MICROTASKS: MicrotaskQueue = {
	queueMicrotask: task => task(),
	flush: () => {},
};

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
	const timing = resolveRuntimeTiming(5_000_000, PSX_GPU_DISPLAY_MODE_PAL_WORD);
	return new Runtime({
		viewport: { width: timing.viewportWidth, height: timing.viewportHeight },
		memory: new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }),
		psxGpuDisplayModeWord: timing.gpuDisplayModeWord,
		ufpsScaled: timing.ufpsScaled,
		cpuHz: timing.cpuHz,
		cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
		vblankCycles: timing.vblankCycles,
		dmaBytesPerSec: timing.dmaBytesPerSec,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	}, new TimingInputSource(), INLINE_MICROTASKS);
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
});

test('runtime timing follows PSX GP1 display mode writes', () => {
	const runtime = createTimingRuntime();

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_SET_DISPLAY_MODE << 24);

	assert.equal(runtime.machine.gxGpu.readDisplayModeWord(), PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal((runtime.machine.gxGpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
	assert.equal(runtime.timing.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_NTSC_WORD);
	assert.equal(runtime.timing.ufpsScaled, NTSC_REFRESH_UFPS_SCALED);
	assert.equal(runtime.timing.totalScanlines, 262);
});

test('runtime timing follows PSX GP1 reset back to PAL', () => {
	const runtime = createTimingRuntime();

	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_SET_DISPLAY_MODE << 24);
	runtime.machine.memory.writeMappedU32LE(IO_GX_GPU_GP1, GX_GPU_GP1_RESET << 24);

	assert.equal(runtime.machine.gxGpu.readDisplayModeWord(), PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal((runtime.machine.gxGpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal(runtime.timing.gpuDisplayModeWord, PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal(runtime.timing.ufpsScaled, 50 * HZ_SCALE);
	assert.equal(runtime.timing.totalScanlines, 313);
});
