import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from 'canvas';

import { BIOS_ATLAS_ID } from '../../machine/ts/rompack/format';
import { resolveTargetAtlasId } from '../../scripts/rompacker/atlasbuilder';
import { buildPalette4GxTextureAtlas } from '../../scripts/rompacker/gx_texture_atlas';
import { createAtlasses } from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource } from '../../scripts/rompacker/rompacker.rompack';
import { GX_CART_ATLAS_ID_LIMIT } from '../../scripts/rompacker/texture_atlas_contract';

test('cart atlas ids stop before the system atlas id', () => {
	assert.equal(GX_CART_ATLAS_ID_LIMIT, BIOS_ATLAS_ID);
	assert.throws(
		() => resolveTargetAtlasId('carts/example/res/player@atlas=254.png', BIOS_ATLAS_ID),
		/reserved system atlas id/,
	);
});

test('palette4 atlas production rejects a seventeenth RGB555 color', () => {
	const rgba = new Uint8ClampedArray(17 * 4);
	for (let color = 0; color < 17; color += 1) {
		const offset = color * 4;
		rgba[offset] = color << 3;
		rgba[offset + 3] = 0xff;
	}
	assert.throws(
		() => buildPalette4GxTextureAtlas(0, 17, 1, rgba),
		/more than 16 RGB555\/STP colors/,
	);
});

test('split atlas allocation cannot enter the system atlas id', async () => {
	const resources: Resource[] = [
		{ type: 'atlas', name: '_atlas_253', ext: '.atlas', id: 1, atlasId: 253 },
		{
			type: 'image',
			name: 'a',
			id: 2,
			collisionType: 'aabb',
			targetAtlasId: 253,
			img: createCanvas(512, 512) as unknown as ImageResource['img'],
		},
		{
			type: 'image',
			name: 'b',
			id: 3,
			collisionType: 'aabb',
			targetAtlasId: 253,
			img: createCanvas(512, 512) as unknown as ImageResource['img'],
		},
	];

	await assert.rejects(
		() => createAtlasses(resources),
		/reserved system atlas id/,
	);
});
