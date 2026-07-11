import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';
import { createOptimizedAtlas, measureOptimizedAtlasBytes, splitAtlasImagesByVramUsage } from '../../scripts/rompacker/atlasbuilder';
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

test('atlas splitter pages images by GX texture residency bytes', () => {
	const pageBudget = measureOptimizedAtlasBytes([
		imageResource('a', 1, 512, 256),
	]);
	const groups = splitAtlasImagesByVramUsage([
		imageResource('a', 1, 512, 256),
		imageResource('b', 2, 512, 256),
	], pageBudget);

	assert.deepEqual(groups.map(group => group.map(image => image.name)), [['a'], ['b']]);
});

test('atlas generation rejects a canvas that exceeds its configured byte limit', () => {
	assert.throws(
		() => createOptimizedAtlas([
			imageResource('a', 1, 1024, 256),
		], 1),
		/exceeding the configured atlas byte limit/,
	);
});
