import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	getPsxGpuVideoStandardTiming,
	getPsxGpuDisplayModeTimingForWord,
	PSX_GPU_DISPLAY_MODE_NTSC_WORD,
	PSX_GPU_DISPLAY_MODE_PAL_WORD,
	NTSC_REFRESH_UFPS_SCALED,
	PSX_MACHINE_SPEC,
} from '../../machine/ts/machine/model_registry';
import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';

test('machine registry exposes the psx fixed hardware model', () => {
	assert.deepEqual(PSX_MACHINE_SPEC, {
		cpuFreqHz: 50_000_000,
		dmaBytesPerSec: 26_214_400,
		ramBytes: 0x00400000,
		geoWorkUnitsPerSec: 16_384_000,
	});
});

test('PSX GPU display mode bit 3 selects PAL and clear bit 3 selects 60000/1001 NTSC timing', () => {
	assert.deepEqual(getPsxGpuVideoStandardTiming('pal'), {
		videoStandard: 'pal',
		refreshUfpsScaled: 50 * HZ_SCALE,
		totalScanlines: 313,
	});
	assert.deepEqual(getPsxGpuVideoStandardTiming('ntsc'), {
		videoStandard: 'ntsc',
		refreshUfpsScaled: 59_940_060,
		totalScanlines: 262,
	});
	assert.equal(NTSC_REFRESH_UFPS_SCALED, 59_940_060);
	assert.deepEqual(getPsxGpuDisplayModeTimingForWord(PSX_GPU_DISPLAY_MODE_PAL_WORD), getPsxGpuVideoStandardTiming('pal'));
	assert.deepEqual(getPsxGpuDisplayModeTimingForWord(PSX_GPU_DISPLAY_MODE_NTSC_WORD), getPsxGpuVideoStandardTiming('ntsc'));
});
