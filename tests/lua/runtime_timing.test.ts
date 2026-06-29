import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';
import { MACHINE_REGION_NTSC_WORD, MACHINE_REGION_PAL_WORD, NTSC_REFRESH_UFPS_SCALED, getMachineRegionTimingForWord } from '../../machine/ts/machine/model_registry';
import { resolveVblankCycles } from '../../machine/ts/machine/runtime/timing';
import { resolveRuntimeTiming } from '../../machine/ts/machine/runtime/boot_timing';

const TEST_MACHINE = {
	render_size: { width: 320, height: 192 },
	namespace: 'test',
	vdp_class: 'psx',
} as const;

test('VBLANK cycles use explicit PAL region scanlines', () => {
	const timing = getMachineRegionTimingForWord(MACHINE_REGION_PAL_WORD);
	assert.equal(timing.totalScanlines, 313);
	assert.equal(resolveVblankCycles(5_000_000, 50 * HZ_SCALE, timing.totalScanlines, 192), 38659);
});

test('VBLANK cycles use explicit NTSC region scanlines', () => {
	const timing = getMachineRegionTimingForWord(MACHINE_REGION_NTSC_WORD);
	assert.equal(timing.totalScanlines, 262);
	assert.equal(resolveVblankCycles(5_000_000, NTSC_REFRESH_UFPS_SCALED, timing.totalScanlines, 192), 22287);
});

test('runtime timing resolves from the explicit region register word', () => {
	const pal = resolveRuntimeTiming(TEST_MACHINE, TEST_MACHINE, 5_000_000, MACHINE_REGION_PAL_WORD);
	const ntsc = resolveRuntimeTiming(TEST_MACHINE, TEST_MACHINE, 5_000_000, MACHINE_REGION_NTSC_WORD);

	assert.equal(pal.regionWord, MACHINE_REGION_PAL_WORD);
	assert.equal(pal.ufpsScaled, 50 * HZ_SCALE);
	assert.equal(pal.totalScanlines, 313);
	assert.equal(pal.vblankCycles, 38659);
	assert.equal(ntsc.regionWord, MACHINE_REGION_NTSC_WORD);
	assert.equal(ntsc.ufpsScaled, NTSC_REFRESH_UFPS_SCALED);
	assert.equal(ntsc.totalScanlines, 262);
	assert.equal(ntsc.vblankCycles, 22287);
});
