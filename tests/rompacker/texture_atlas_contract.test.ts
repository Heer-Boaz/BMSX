import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from 'canvas';

import { PSX_VRAM_STAGING_BYTES } from '../../machine/ts/machine/model_registry';
import { BIOS_ATLAS_ID } from '../../machine/ts/rompack/format';
import { resolveTargetAtlasId } from '../../scripts/rompacker/atlasbuilder';
import { createAtlasses } from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource } from '../../scripts/rompacker/rompacker.rompack';
import {
	RPU_CART_ATLAS_ID_LIMIT,
	RPU_QUAD_DESCRIPTOR_END_VRAM_ADDR,
	RPU_QUAD_SURFACE_DESC_COUNT,
} from '../../scripts/rompacker/texture_atlas_contract';

test('RPU quad descriptors stay inside staging VRAM', () => {
	assert.equal(RPU_QUAD_DESCRIPTOR_END_VRAM_ADDR <= PSX_VRAM_STAGING_BYTES, true);
});

test('cart atlas descriptor ids stop before the system atlas descriptor', () => {
	assert.equal(RPU_CART_ATLAS_ID_LIMIT, BIOS_ATLAS_ID);
	assert.equal(RPU_CART_ATLAS_ID_LIMIT < RPU_QUAD_SURFACE_DESC_COUNT, true);
	assert.throws(
		() => resolveTargetAtlasId('carts/example/res/player@atlas=254.png', BIOS_ATLAS_ID),
		/reserved system atlas id/,
	);
});

test('split atlas allocation cannot enter the system atlas descriptor id', async () => {
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
