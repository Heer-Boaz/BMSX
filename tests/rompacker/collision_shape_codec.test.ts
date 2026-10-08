import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	decodeCollisionShapeVariant,
	encodeCollisionShapeVariants,
	type CollisionShapeVariant,
	type CollisionShapeVariants,
} from '../../toolchain/ts/rompack/collision_shape_codec';

const variantNames = ['original', 'fliph', 'flipv', 'fliphv'] as const;

test('compound collision variants preserve their distinct bounds and mixed descriptor payloads', () => {
	const compound = (x: number, y: number): CollisionShapeVariant => ({
		bounds: { left: x - 2, top: y - 3, right: x + 10, bottom: y + 12 },
		pieces: [
			{ kind: 'aabb', bounds: { left: x, top: y, right: x + 2, bottom: y + 5 } },
			{ kind: 'convex_poly', vertices: [x + 3, y, x + 8, y + 4, x + 4, y + 9] },
			{ kind: 'aabb', bounds: { left: x + 8, top: y + 6, right: x + 9, bottom: y + 8 } },
		],
	});
	const variants: CollisionShapeVariants = {
		original: compound(0, 0), fliph: compound(-10, 0),
		flipv: compound(0, -12), fliphv: compound(-10, -12),
	};
	const encoded = encodeCollisionShapeVariants(variants);
	const allocation = new Uint8Array(encoded.length + 19).fill(0xa5);
	allocation.set(encoded, 7);
	const bytes = allocation.subarray(7, 7 + encoded.length);
	const before = allocation.slice();
	for (const name of variantNames) assert.deepEqual(decodeCollisionShapeVariant(bytes, name), variants[name]);
	assert.deepEqual(decodeCollisionShapeVariant(bytes), variants.original);
	assert.deepEqual(allocation, before);
});

test('single convex descriptors use their stored polygon bounds and f32 coordinates, not the variant envelope', () => {
	const variants: CollisionShapeVariants = {
		original: { bounds: { left: -99, top: -99, right: 99, bottom: 99 }, pieces: [
			{ kind: 'convex_poly', vertices: [0.1, 0.2, 8.3, 1.4, 2.5, 7.6] },
		] },
		fliph: { bounds: { left: -99, top: -99, right: 99, bottom: 99 }, pieces: [
			{ kind: 'convex_poly', vertices: [-0.1, 0.2, -8.3, 1.4, -2.5, 7.6] },
		] },
		flipv: { bounds: { left: -99, top: -99, right: 99, bottom: 99 }, pieces: [
			{ kind: 'convex_poly', vertices: [0.1, -0.2, 8.3, -1.4, 2.5, -7.6] },
		] },
		fliphv: { bounds: { left: -99, top: -99, right: 99, bottom: 99 }, pieces: [
			{ kind: 'convex_poly', vertices: [-0.1, -0.2, -8.3, -1.4, -2.5, -7.6] },
		] },
	};
	const encoded = encodeCollisionShapeVariants(variants);
	const allocation = new Uint8Array(encoded.length + 3);
	allocation.set(encoded, 3);
	for (const name of variantNames) {
		const piece = variants[name].pieces![0];
		assert.ok(piece.kind === 'convex_poly');
		const x = [piece.vertices[0], piece.vertices[2], piece.vertices[4]];
		const y = [piece.vertices[1], piece.vertices[3], piece.vertices[5]];
		assert.deepEqual(decodeCollisionShapeVariant(allocation.subarray(3), name), {
			bounds: {
				left: Math.fround(Math.min(...x)), top: Math.fround(Math.min(...y)),
				right: Math.fround(Math.max(...x)), bottom: Math.fround(Math.max(...y)),
			},
			pieces: [{ kind: 'convex_poly', vertices: piece.vertices.map(Math.fround) }],
		});
	}
});

for (const form of ['single', 'empty', 'bounds'] as const) {
	test(`${form} AABB variants decode the effective stored bounds`, () => {
		const bounds = [
			{ left: 0.1, top: 0.2, right: 5.3, bottom: 6.4 },
			{ left: -5.3, top: 0.2, right: -0.1, bottom: 6.4 },
			{ left: 0.1, top: -6.4, right: 5.3, bottom: -0.2 },
			{ left: -5.3, top: -6.4, right: -0.1, bottom: -0.2 },
		];
		const makeVariant = (index: number): CollisionShapeVariant => form === 'single'
			? { bounds: { left: -99, top: -99, right: 99, bottom: 99 }, pieces: [{ kind: 'aabb', bounds: bounds[index] }] }
			: form === 'empty' ? { bounds: bounds[index], pieces: [] } : { bounds: bounds[index] };
		const bytes = encodeCollisionShapeVariants({
			original: makeVariant(0), fliph: makeVariant(1), flipv: makeVariant(2), fliphv: makeVariant(3),
		});
		for (let index = 0; index < variantNames.length; index++) {
			const expected = bounds[index];
			assert.deepEqual(decodeCollisionShapeVariant(bytes, variantNames[index]), {
				bounds: {
					left: Math.fround(expected.left), top: Math.fround(expected.top),
					right: Math.fround(expected.right), bottom: Math.fround(expected.bottom),
				},
			});
		}
	});
}
