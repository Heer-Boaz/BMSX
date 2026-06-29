import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	getMachineRegionTiming,
	getMachineRegionTimingForWord,
	MACHINE_REGION_NTSC_WORD,
	MACHINE_REGION_PAL_WORD,
	NTSC_REFRESH_UFPS_SCALED,
	PSX_MODEL_PROFILE,
	PSX_VDP_CLASS_PROFILE,
} from '../../machine/ts/machine/model_registry';
import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';

test('machine registry exposes the psx fixed hardware model', () => {
	assert.deepEqual(PSX_MODEL_PROFILE, {
		cpuFreqHz: 50_000_000,
		imgDecBytesPerSec: 26_214_400,
		dmaBytesPerSecIso: 8_388_608,
		dmaBytesPerSecBulk: 26_214_400,
		ramBytes: 0x08000000,
		slotBytes: 167_772_160,
		stagingBytes: 41_943_040,
		biosRenderWidth: 320,
		biosRenderHeight: 240,
	});
});

test('machine registry exposes the psx VDP device class throughput', () => {
	assert.deepEqual(PSX_VDP_CLASS_PROFILE, {
		vdpWorkUnitsPerSec: 25_600,
		geoWorkUnitsPerSec: 16_384_000,
	});
});

test('machine region timing uses PAL and 60000/1001 NTSC timing', () => {
	assert.deepEqual(getMachineRegionTiming('pal'), {
		region: 'pal',
		refreshUfpsScaled: 50 * HZ_SCALE,
		totalScanlines: 313,
	});
	assert.deepEqual(getMachineRegionTiming('ntsc'), {
		region: 'ntsc',
		refreshUfpsScaled: 59_940_060,
		totalScanlines: 262,
	});
	assert.equal(NTSC_REFRESH_UFPS_SCALED, 59_940_060);
	assert.deepEqual(getMachineRegionTimingForWord(MACHINE_REGION_PAL_WORD), getMachineRegionTiming('pal'));
	assert.deepEqual(getMachineRegionTimingForWord(MACHINE_REGION_NTSC_WORD), getMachineRegionTiming('ntsc'));
});
