import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HZ_SCALE } from '../../src/bmsx/platform/platform';
import { resolveTotalScanlines, resolveVblankCycles } from '../../src/bmsx/machine/runtime/timing';

test('VBLANK cycles use PAL-like scanlines for 50 Hz carts', () => {
	assert.equal(resolveTotalScanlines(50 * HZ_SCALE), 313);
	assert.equal(resolveVblankCycles(5_000_000, 50 * HZ_SCALE, 192), 38659);
});

test('VBLANK cycles use NTSC-like scanlines for 60 Hz carts', () => {
	assert.equal(resolveTotalScanlines(60 * HZ_SCALE), 262);
	assert.equal(resolveVblankCycles(5_000_000, 60 * HZ_SCALE, 192), 22265);
});
