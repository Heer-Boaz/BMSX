import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	getPsxGpuVideoStandardTiming,
	getPsxGpuDisplayModeTimingForWord,
	PSX_GPU_DISPLAY_MODE_NTSC_WORD,
	PSX_GPU_DISPLAY_MODE_PAL_WORD,
	NTSC_REFRESH_UFPS_SCALED,
	PSX_DMA_RAM_CYCLES_PER_WORD,
	PSX_DMA_RAM_BURST_SETUP_CYCLES,
	PSX_DMA_SYSTEM_ROM_CYCLES_PER_WORD,
	PSX_DMA_CART_ROM_CYCLES_PER_WORD,
	PSX_DMA_CART_ROM_BURST_SETUP_CYCLES,
	PSX_IMGDEC_CYCLES_PER_OUTPUT_WORD,
	PSX_MACHINE_SPEC,
} from '../../machine/ts/machine/model_registry';
import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';

test('machine registry exposes the psx fixed hardware model', () => {
	assert.deepEqual(PSX_MACHINE_SPEC, {
		cpuFreqHz: 33_868_800,
		dmaRamCyclesPerWord: 1,
		dmaRamBurstSetupCycles: 1,
		dmaSystemRomCyclesPerWord: 1,
		dmaCartRomCyclesPerWord: 8,
		dmaCartRomBurstSetupCycles: 4,
		imgDecCyclesPerOutputWord: 2,
		ramBytes: 0x00400000,
		geoWorkUnitsPerSec: 16_384_000,
	});
	assert.equal(PSX_MACHINE_SPEC.dmaRamCyclesPerWord, PSX_DMA_RAM_CYCLES_PER_WORD);
	assert.equal(PSX_MACHINE_SPEC.dmaRamBurstSetupCycles, PSX_DMA_RAM_BURST_SETUP_CYCLES);
	assert.equal(PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord, PSX_DMA_SYSTEM_ROM_CYCLES_PER_WORD);
	assert.equal(PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord, PSX_DMA_CART_ROM_CYCLES_PER_WORD);
	assert.equal(PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles, PSX_DMA_CART_ROM_BURST_SETUP_CYCLES);
	assert.equal(PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord, PSX_IMGDEC_CYCLES_PER_OUTPUT_WORD);
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
