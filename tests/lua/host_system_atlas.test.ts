import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	HOST_SYSTEM_ATLAS,
	hostSystemAtlasImage,
} from '../../machine/ts/rompack/host_system_atlas';

test('host system atlas exposes generated native RGBA bytes', () => {
	const pixels = HOST_SYSTEM_ATLAS.pixels;
	const whitePixel = hostSystemAtlasImage('whitepixel');
	const whitePixelOffset = (whitePixel.v * HOST_SYSTEM_ATLAS.width + whitePixel.u) * 4;

	assert.equal(pixels.byteLength, HOST_SYSTEM_ATLAS.width * HOST_SYSTEM_ATLAS.height * 4);
	assert.deepEqual(Array.from(pixels.subarray(whitePixelOffset, whitePixelOffset + 4)), [255, 255, 255, 255]);
	for (let index = 1; index < HOST_SYSTEM_ATLAS.images.length; index += 1) {
		assert.ok(HOST_SYSTEM_ATLAS.images[index - 1].id < HOST_SYSTEM_ATLAS.images[index].id);
	}
});

test('host system atlas image lookup is strict', () => {
	assert.equal(hostSystemAtlasImage('whitepixel').width, 1);
	assert.throws(() => hostSystemAtlasImage('missing_host_atlas_image'), /not in the host system atlas/);
});
