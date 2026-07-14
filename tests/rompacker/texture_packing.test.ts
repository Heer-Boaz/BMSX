import assert from 'node:assert/strict';
import test from 'node:test';

import { createCanvas } from 'canvas';

import { createTextureAtlas } from '../../scripts/rompacker/atlasbuilder';
import type { ImageResource } from '../../scripts/rompacker/rompacker.rompack';

function imageResource(name: string, id: number, width: number, height: number): ImageResource {
	return {
		type: 'image',
		name,
		id,
		collisionType: 'aabb',
		targetAtlasId: 0,
		img: createCanvas(width, height) as unknown as ImageResource['img'],
	};
}

test('page-local texture packing moves an image to the next hardware page instead of crossing it', () => {
	const first = imageResource('first', 1, 200, 200);
	const second = imageResource('second', 2, 200, 200);
	const texture = createTextureAtlas([first, second], {
		maxPixelWidth: 512,
		maxHeight: 256,
		pageLocal: true,
	});

	assert.equal(texture.width, 456);
	assert.deepEqual([first.textureU, first.textureV], [0, 0]);
	assert.deepEqual([second.textureU, second.textureV], [256, 0]);
});

test('surface texture packing keeps an intentionally oversized image contiguous', () => {
	const wide = imageResource('wide', 1, 264, 32);
	const ordinary = imageResource('ordinary', 2, 128, 64);
	createTextureAtlas([wide, ordinary], {
		maxPixelWidth: 512,
		maxHeight: 256,
		pageLocal: false,
	});

	assert.deepEqual([wide.textureU, wide.textureV], [0, 0]);
	assert.deepEqual([ordinary.textureU, ordinary.textureV], [264, 0]);
});

test('page-local texture packing rejects surfaces wider than one hardware page', () => {
	assert.throws(
		() => createTextureAtlas([imageResource('wide', 1, 264, 32)], {
			maxPixelWidth: 512,
			maxHeight: 256,
			pageLocal: true,
		}),
		/does not fit one 256x256 texture page/,
	);
});

test('texture packing rejects an image larger than its physical texture slots', () => {
	assert.throws(
		() => createTextureAtlas([imageResource('wide', 1, 513, 1)], {
			maxPixelWidth: 512,
			maxHeight: 256,
			pageLocal: true,
		}),
		/does not fit its 512x256 pixel slots/,
	);
});
