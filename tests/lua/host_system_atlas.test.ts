import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	HOST_SYSTEM_ATLAS_HEIGHT,
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasImage,
	hostSystemAtlasPixels,
} from '../../machine/ts/rompack/host_system_atlas';

test('host system atlas decodes generated RGBA bytes deterministically', () => {
	const pixels = hostSystemAtlasPixels();
	const whitePixel = hostSystemAtlasImage('whitepixel');
	const whitePixelOffset = (whitePixel.v * HOST_SYSTEM_ATLAS_WIDTH + whitePixel.u) * 4;

	assert.equal(pixels.byteLength, HOST_SYSTEM_ATLAS_WIDTH * HOST_SYSTEM_ATLAS_HEIGHT * 4);
	assert.deepEqual(Array.from(pixels.subarray(whitePixelOffset, whitePixelOffset + 4)), [255, 255, 255, 255]);
	assert.equal(hostSystemAtlasPixels(), pixels);
});

test('host system atlas image lookup is strict', () => {
	assert.equal(hostSystemAtlasImage('whitepixel').width, 1);
	assert.throws(() => hostSystemAtlasImage('missing_host_atlas_image'), /not in the host system atlas/);
});
