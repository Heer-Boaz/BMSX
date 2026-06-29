import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HZ_SCALE } from '../../machine/ts/machine/runtime/timing/constants';
import { NTSC_REFRESH_UFPS_SCALED } from '../../machine/ts/machine/model_registry';
import { resolveTotalScanlines, resolveVblankCycles } from '../../machine/ts/machine/runtime/timing';

test('VBLANK cycles use PAL-like scanlines for 50 Hz carts', () => {
	assert.equal(resolveTotalScanlines(50 * HZ_SCALE), 313);
	assert.equal(resolveVblankCycles(5_000_000, 50 * HZ_SCALE, 192), 38659);
});

test('VBLANK cycles use NTSC-like scanlines for 60000/1001 Hz carts', () => {
	assert.equal(resolveTotalScanlines(NTSC_REFRESH_UFPS_SCALED), 262);
	assert.equal(resolveVblankCycles(5_000_000, NTSC_REFRESH_UFPS_SCALED, 192), 22287);
});
