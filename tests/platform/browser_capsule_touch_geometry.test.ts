import assert from 'node:assert/strict';
import test from 'node:test';
import { contactIntersectsHorizontalCapsule, pointDistanceToHorizontalCapsule,
	type HorizontalCapsule } from '../../hosts/browser/touch_geometry';

const capsule: HorizontalCapsule = { halfLength: 30, radius: 18 };

test('capsule point distance uses finite end caps, not an infinite line or enclosing circle', () => {
	assert.equal(pointDistanceToHorizontalCapsule(0, 0, capsule), 0);
	assert.equal(pointDistanceToHorizontalCapsule(48, 0, capsule), 0);
	assert.equal(pointDistanceToHorizontalCapsule(49, 0, capsule), 1);
	assert.equal(pointDistanceToHorizontalCapsule(500, 0, capsule), 452);
	assert.equal(pointDistanceToHorizontalCapsule(0, 19, capsule), 1);
	assert.equal(contactIntersectsHorizontalCapsule(0, 18, 0, 0, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(0, 18.000001, 0, 0, capsule), false);
	assert.equal(contactIntersectsHorizontalCapsule(-48, 0, 0, 0, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(48, 0, 0, 0, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(100, 0, 14, 14, capsule), false);
	assert.equal(contactIntersectsHorizontalCapsule(45, 16, 0, 0, capsule), false,
		'the empty bounding-rectangle corner is outside the circular end cap');
	assert.equal(contactIntersectsHorizontalCapsule(0, 47, 0, 0, capsule), false,
		'the empty enclosing-circle interior is not filled');
});

test('circular contacts dilate the actual capsule and include external tangency', () => {
	assert.equal(contactIntersectsHorizontalCapsule(62, 0, 14, 14, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(62.000001, 0, 14, 14, capsule), false);
	assert.equal(contactIntersectsHorizontalCapsule(0, 32, 14, 14, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(0, 32.000001, 14, 14, capsule), false);
	assert.equal(contactIntersectsHorizontalCapsule(61, 31, 14, 14, capsule), false,
		'overlapping contact and control bounding boxes do not invent a corner hit');
	assert.equal(contactIntersectsHorizontalCapsule(40, 10, 14, 14, capsule), true);
});

test('both finite end caps accept anisotropic and zero-axis segment contacts', () => {
	for (const sign of [-1, 1]) {
		assert.equal(contactIntersectsHorizontalCapsule(sign * 50, 0, 2, 14, capsule), true);
		assert.equal(contactIntersectsHorizontalCapsule(sign * 50.000001, 0, 2, 14, capsule), false);
		assert.equal(contactIntersectsHorizontalCapsule(sign * 58, 0, 10, 0, capsule), true);
		assert.equal(contactIntersectsHorizontalCapsule(sign * 58.000001, 0, 10, 0, capsule), false);
	}
	assert.equal(contactIntersectsHorizontalCapsule(0, 20, 14, 2, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(0, 20.000001, 14, 2, capsule), false);
	assert.equal(contactIntersectsHorizontalCapsule(0, 24, 0, 6, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(0, 24.000001, 0, 6, capsule), false);
	assert.equal(contactIntersectsHorizontalCapsule(0, 0, 0, 100, capsule), true);
	assert.equal(contactIntersectsHorizontalCapsule(0, 0, 100, 0, capsule), true);
});

test('the centerline interval and seam have exact vertical ellipse supports', () => {
	for (const x of [-30, -20, 0, 20, 30]) {
		for (const [halfWidth, halfHeight] of [[14, 3], [3, 14], [28, 0.5], [0.5, 28], [1000000, 0.000001]]) {
			for (const sign of [-1, 1]) {
				assert.equal(contactIntersectsHorizontalCapsule(x, sign * (18 + halfHeight), halfWidth, halfHeight, capsule), true);
				assert.equal(contactIntersectsHorizontalCapsule(x, sign * (18 + halfHeight + 0.000001), halfWidth, halfHeight, capsule), false);
			}
		}
	}
});

test('analytical end-cap normals prove exact circular arcs with anisotropic ellipses', () => {
	for (const angle of [-1.4, -1.2, -0.7, -0.1, 0, 0.1, 0.7, 1.2, 1.4]) {
		const nx = Math.cos(angle);
		const ny = Math.sin(angle);
		for (const [halfWidth, halfHeight] of [[14, 3], [3, 14], [28, 0.5], [0.5, 28], [1000000, 0.000001]]) {
			const support = Math.hypot(halfWidth * nx, halfHeight * ny);
			const ellipseX = halfWidth * halfWidth * nx / support;
			const ellipseY = halfHeight * halfHeight * ny / support;
			for (const sign of [-1, 1]) {
				for (const offset of [-0.000001, 0.000001]) {
					const x = sign * (30 + (18 + offset) * nx + ellipseX);
					const y = (18 + offset) * ny + ellipseY;
					assert.equal(contactIntersectsHorizontalCapsule(x, y, halfWidth, halfHeight, capsule), offset < 0,
						`angle=${angle}, axes=${halfWidth},${halfHeight}, sign=${sign}, offset=${offset}`);
				}
			}
		}
	}
});

test('seeded independent support constructions cover varied capsule and contact dimensions', () => {
	// Independent oracle: a common outward normal supplies support points of the
	// capsule end disk and ellipse. Their sum is an external tangency, so moving
	// along that normal proves both sides without using a collision query as oracle.
	let seed = 0x42534d58;
	const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
	for (let sample = 0; sample < 1000; sample += 1) {
		const shape = { halfLength: 10 + 150 * random(), radius: 2 + 40 * random() };
		const halfWidth = 0.1 + 100 * random();
		const halfHeight = 0.1 + 100 * random();
		const angle = (random() - 0.5) * Math.PI;
		const nx = Math.cos(angle);
		const ny = Math.sin(angle);
		const support = Math.hypot(halfWidth * nx, halfHeight * ny);
		const ellipseX = halfWidth * halfWidth * nx / support;
		const ellipseY = halfHeight * halfHeight * ny / support;
		for (const sign of [-1, 1]) {
			for (const offset of [-0.000001, 0.000001]) {
				const x = sign * (shape.halfLength + (shape.radius + offset) * nx + ellipseX);
				const y = (shape.radius + offset) * ny + ellipseY;
				assert.equal(contactIntersectsHorizontalCapsule(x, y, halfWidth, halfHeight, shape), offset < 0,
					`sample=${sample}, sign=${sign}, offset=${offset}`);
			}
		}
	}
});
