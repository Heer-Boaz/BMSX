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
	VDP_MODE_MSX1_WORD,
	VDP_MODE_MSX1_PROFILE,
	VDP_MODE_MSX2_WORD,
	VDP_MODE_MSX2_PROFILE,
	VDP_MODE_PSX_WORD,
	VDP_MODE_PSX_PROFILE,
	getMachineVdpModeProfile,
} from '../../machine/ts/machine/model_registry';
import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';

test('machine registry exposes the psx fixed hardware model', () => {
	assert.deepEqual(PSX_MODEL_PROFILE, {
		cpuFreqHz: 50_000_000,
		imgDecBytesPerSec: 26_214_400,
		dmaBytesPerSecIso: 8_388_608,
		dmaBytesPerSecBulk: 26_214_400,
		ramBytes: 0x00400000,
		slotBytes: 0x00200000,
		stagingBytes: 0x001c0000,
		biosVdpMode: VDP_MODE_PSX_WORD,
	});
});

test('machine registry exposes the psx VDP device class throughput', () => {
	assert.deepEqual(PSX_VDP_CLASS_PROFILE, {
		vdpWorkUnitsPerSec: 25_600,
		geoWorkUnitsPerSec: 16_384_000,
	});
});

test('machine registry exposes VDP modes', () => {
	assert.deepEqual(getMachineVdpModeProfile(VDP_MODE_MSX1_WORD), VDP_MODE_MSX1_PROFILE);
	assert.deepEqual(getMachineVdpModeProfile(VDP_MODE_MSX2_WORD), VDP_MODE_MSX2_PROFILE);
	assert.deepEqual(getMachineVdpModeProfile(VDP_MODE_PSX_WORD), VDP_MODE_PSX_PROFILE);
	assert.deepEqual(VDP_MODE_MSX1_PROFILE, { mode: VDP_MODE_MSX1_WORD, renderWidth: 256, renderHeight: 192 });
	assert.deepEqual(VDP_MODE_MSX2_PROFILE, { mode: VDP_MODE_MSX2_WORD, renderWidth: 256, renderHeight: 212 });
	assert.deepEqual(VDP_MODE_PSX_PROFILE, { mode: VDP_MODE_PSX_WORD, renderWidth: 320, renderHeight: 240 });
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
