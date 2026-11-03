import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas, loadImage } from 'canvas';
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
			img: await loadImage(image.toBuffer('image/png')),
		};
		const [asset] = await generateRomAssets([source]);
		const metadata = asset.imgmeta!;
		assert.deepEqual(Object.keys(metadata).sort(), ['gx_atlas_id', 'height', 'texture_u', 'texture_v', 'width'],
			'image metadata must not duplicate the ROM collision geometry');
		const original = decodeCollisionShapeVariant(asset.collision_bin_buffer!, 'original');
		assert.equal(original.pieces?.length, collisionType === 'aabb' ? undefined : collisionType === 'convex' ? 1 : 2);
		for (const [name, expected] of [
			['original', [1, 1, 10, 6]], ['fliph', [3, 1, 12, 6]],
			['flipv', [1, 4, 10, 9]], ['fliphv', [3, 4, 12, 9]],
		] as const) {
			const decoded = decodeCollisionShapeVariant(asset.collision_bin_buffer!, name);
			assert.deepEqual(decoded.bounds, { left: expected[0], top: expected[1], right: expected[2], bottom: expected[3] });
			if (collisionType !== 'aabb') {
				const polygons = original.pieces!;
				assert.equal(decoded.pieces!.length, polygons.length);
				for (let index = 0; index < polygons.length; index++) {
					const piece = decoded.pieces![index];
					const polygon = polygons[index];
					assert(piece.kind === 'convex_poly');
					assert(polygon.kind === 'convex_poly');
					assert.deepEqual(piece.vertices, polygon.vertices.map((coordinate, axis) => axis % 2 === 0
						? name === 'fliph' || name === 'fliphv' ? 13 - coordinate : coordinate
						: name === 'flipv' || name === 'fliphv' ? 10 - coordinate : coordinate));
				}
			}
		}
	});
}
