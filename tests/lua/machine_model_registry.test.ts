import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	getPsxGpuVideoStandardTiming,
	getPsxGpuDisplayModeTimingForWord,
	PSX_GPU_DISPLAY_MODE_NTSC_WORD,
	PSX_GPU_DISPLAY_MODE_PAL_WORD,
	NTSC_REFRESH_UFPS_SCALED,
	PSX_MACHINE_SPEC,
	PSX_VDP_WORK_SPEC,
	PSX_GPU_DISPLAY_SIZE_SPEC,
} from '../../machine/ts/machine/model_registry';
import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';

test('machine registry exposes the psx fixed hardware model', () => {
	assert.deepEqual(PSX_MACHINE_SPEC, {
		cpuFreqHz: 50_000_000,
		imgDecBytesPerSec: 26_214_400,
		dmaBytesPerSecIso: 8_388_608,
		dmaBytesPerSecBulk: 26_214_400,
		ramBytes: 0x00400000,
		textureBytes: 0x00200000,
		stagingBytes: 0x00022000,
	});
});

test('machine registry exposes the psx VDP device class throughput', () => {
	assert.deepEqual(PSX_VDP_WORK_SPEC, {
		vdpWorkUnitsPerSec: 25_600,
		geoWorkUnitsPerSec: 16_384_000,
	});
});

test('machine registry exposes the fixed PSX GPU display size without a VDP mode profile', () => {
	assert.deepEqual(PSX_GPU_DISPLAY_SIZE_SPEC, { renderWidth: 320, renderHeight: 240 });
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
