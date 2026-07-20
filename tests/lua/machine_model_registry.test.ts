import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	getPsxGpuVideoStandardTiming,
	getPsxGpuDisplayModeTimingForWord,
	PSX_GPU_DISPLAY_MODE_NTSC_WORD,
	PSX_GPU_DISPLAY_MODE_PAL_WORD,
	NTSC_REFRESH_UFPS_SCALED,
	PSX_DMA_RAM_BASE_CYCLES_PER_WORD,
	PSX_DMA_RAM_ROW_REOPEN_CYCLES,
	PSX_DMA_ROM_WAIT_CYCLES_PER_WORD,
	PSX_MACHINE_SPEC,
} from '../../machine/ts/machine/model_registry';
import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';

test('machine registry exposes the psx fixed hardware model', () => {
	assert.deepEqual(PSX_MACHINE_SPEC, {
		cpuFreqHz: 33_868_800,
		dmaWordsPerSec: 8_467_200,
		dmaRamRowReopenCycles: 12,
		dmaRomWaitCyclesPerWord: 10,
		ramBytes: 0x00400000,
		geoWorkUnitsPerSec: 16_384_000,
	});
	assert.equal(PSX_MACHINE_SPEC.cpuFreqHz / PSX_MACHINE_SPEC.dmaWordsPerSec, PSX_DMA_RAM_BASE_CYCLES_PER_WORD);
	assert.equal(PSX_MACHINE_SPEC.dmaRamRowReopenCycles, PSX_DMA_RAM_ROW_REOPEN_CYCLES);
	assert.equal(PSX_MACHINE_SPEC.dmaRomWaitCyclesPerWord, PSX_DMA_ROM_WAIT_CYCLES_PER_WORD);
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
