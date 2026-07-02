import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';
import { RPU_QUAD_MAX_CART_ATLAS_BYTES } from '../../scripts/rompacker/texture_atlas_contract';
import { createOptimizedAtlas, splitAtlasImagesByVramUsage } from '../../scripts/rompacker/atlasbuilder';
import type { ImageResource } from '../../scripts/rompacker/rompacker.rompack';

function imageResource(name: string, id: number, width: number, height: number): ImageResource {
	return {
		type: 'image',
		name,
		id,
		collisionType: 'aabb',
		img: createCanvas(width, height) as unknown as ImageResource['img'],
	};
}

test('atlas splitter pages images by VDP texture slot bytes', () => {
	const groups = splitAtlasImagesByVramUsage([
		imageResource('a', 1, 512, 256),
		imageResource('b', 2, 512, 256),
	], RPU_QUAD_MAX_CART_ATLAS_BYTES);

	assert.deepEqual(groups.map(group => group.map(image => image.name)), [['a'], ['b']]);
});

test('atlas generation rejects a canvas that exceeds the VDP texture slot', () => {
	assert.throws(
		() => createOptimizedAtlas([
			imageResource('a', 1, 1024, 256),
		], RPU_QUAD_MAX_CART_ATLAS_BYTES),
		/exceeding the VDP texture slot budget/,
	);
});
