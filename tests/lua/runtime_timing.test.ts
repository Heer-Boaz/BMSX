import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';
import { PSX_GPU_DISPLAY_MODE_NTSC_WORD, PSX_GPU_DISPLAY_MODE_PAL_WORD, NTSC_REFRESH_UFPS_SCALED, getPsxGpuDisplayModeTimingForWord } from '../../machine/ts/machine/model_registry';
import { resolveVblankCycles } from '../../machine/ts/machine/runtime/timing';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';

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
