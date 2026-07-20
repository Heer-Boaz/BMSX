import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HeadlessPresentSurface } from '../../machine/ts/render/headless/present_surface';

test('headless presentation borrows the retained scanout without copying it', () => {
	const surface = new HeadlessPresentSurface();
	const scanout = new Uint8Array([
		0x11, 0x22, 0x33, 0x00,
		0x44, 0x55, 0x66, 0x80,
	]);
	surface.present2D(scanout, 2, 1);

	const presented = surface.borrowPixels();
	assert.equal(presented, scanout);
});
