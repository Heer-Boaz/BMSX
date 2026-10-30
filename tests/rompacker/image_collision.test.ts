import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from 'canvas';
import { generateRomAssets } from '../../scripts/rompacker/rombuilder';
import type { ImageResource } from '../../scripts/rompacker/rompacker.rompack';
import { decodeCollisionShapeVariant } from '../../toolchain/ts/rompack/collision_shape_codec';

for (const collisionType of ['aabb', 'convex', 'concave'] as const) {
	test(`image ${collisionType} variants reflect the same pixel-center geometry and bounds`, async () => {
		const image = createCanvas(14, 11), context = image.getContext('2d');
		context.fillStyle = '#fff';
		context.fillRect(1, 1, 3, 3);
		context.fillRect(8, 4, 3, 3);
		const source: ImageResource = {
			type: 'image', name: 'asymmetric', id: 1, collisionType,
			targetAtlasName: 'fixture', textureU: 0, textureV: 0,
			img: image as unknown as ImageResource['img'],
		};
		const [asset] = await generateRomAssets([source]);
		const metadata = asset.imgmeta!;
		for (const [name, expected] of [
			['original', [1, 1, 10, 6]], ['fliph', [3, 1, 12, 6]],
			['flipv', [1, 4, 10, 9]], ['fliphv', [3, 4, 12, 9]],
		] as const) {
			const bounds = metadata.boundingbox![name];
			assert.deepEqual([bounds.left, bounds.top, bounds.right, bounds.bottom], expected);
			const decoded = decodeCollisionShapeVariant(asset.collision_bin_buffer!, name);
			assert.deepEqual(decoded.bounds, { left: expected[0], top: expected[1], right: expected[2], bottom: expected[3] });
			if (collisionType !== 'aabb') {
				const polygons = metadata.hitpolygons![name];
				assert.equal(decoded.pieces!.length, polygons.length);
				for (let index = 0; index < polygons.length; index++) {
					const piece = decoded.pieces![index];
					assert(piece.kind === 'convex_poly');
					assert.deepEqual(piece.vertices, polygons[index]);
				}
			}
		}
		assert.equal(metadata.hitpolygons?.original.length, collisionType === 'aabb' ? undefined : collisionType === 'convex' ? 1 : 2);
	});
}
