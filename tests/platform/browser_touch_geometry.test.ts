import assert from 'node:assert/strict';
import test from 'node:test';
import { contactIntersectsCircle } from '../../hosts/browser/touch_geometry';

test('circular contacts use circular area and inclusive external tangency', () => {
	assert.equal(contactIntersectsCircle(54, 0, 14, 14, 40), true);
	assert.equal(contactIntersectsCircle(54.000001, 0, 14, 14, 40), false);
	assert.equal(contactIntersectsCircle(0, -54, 14, 14, 40), true);
	assert.equal(contactIntersectsCircle(22, -22, 14, 14, 40), true);
	assert.equal(contactIntersectsCircle(-42, 42, 14, 14, 40), false,
		'the empty corner of a contact bounding rectangle cannot press the adjacent button');
});

test('a circular thumb near A does not invent a diagonal A+B chord', () => {
	const x = 126;
	const y = 146;
	assert.equal(contactIntersectsCircle(x - 104, y - 168, 14, 14, 40), true);
	assert.equal(contactIntersectsCircle(x - 168, y - 104, 14, 14, 40), false);
});

test('zero contact axes have point and segment geometry', () => {
	assert.equal(contactIntersectsCircle(3, 4, 0, 0, 5), true);
	assert.equal(contactIntersectsCircle(3, 4.000001, 0, 0, 5), false);
	assert.equal(contactIntersectsCircle(10, 5, 10, 0, 5), true);
	assert.equal(contactIntersectsCircle(10, 5.000001, 10, 0, 5), false);
	assert.equal(contactIntersectsCircle(13, 4, 10, 0, 5), true);
	assert.equal(contactIntersectsCircle(13, 4.000001, 10, 0, 5), false);
	assert.equal(contactIntersectsCircle(-4, -13, 0, 10, 5), true);
	assert.equal(contactIntersectsCircle(-4.000001, -13, 0, 10, 5), false);
	assert.equal(contactIntersectsCircle(9, 0, 10, 0, 0), true);
	assert.equal(contactIntersectsCircle(11, 0, 10, 0, 0), false);
});

test('ellipse containment and cardinal tangencies are inclusive', () => {
	assert.equal(contactIntersectsCircle(0, 0, 9, 3, 0), true);
	assert.equal(contactIntersectsCircle(8, 0, 9, 3, 0), true);
	assert.equal(contactIntersectsCircle(9, 0, 9, 3, 0), true);
	assert.equal(contactIntersectsCircle(9.000001, 0, 9, 3, 0), false);
	assert.equal(contactIntersectsCircle(16, 0, 9, 3, 7), true);
	assert.equal(contactIntersectsCircle(16.000001, 0, 9, 3, 7), false);
	assert.equal(contactIntersectsCircle(0, 10, 9, 3, 7), true);
	assert.equal(contactIntersectsCircle(0, 10.000001, 9, 3, 7), false);
});

test('anisotropic contact does not fill its bounding rectangle corners', () => {
	assert.equal(contactIntersectsCircle(15, 10, 10, 2, 10), false);
	assert.equal(contactIntersectsCircle(0, 12, 10, 2, 10), true);
	assert.equal(contactIntersectsCircle(20, 0, 10, 2, 10), true);
	assert.equal(contactIntersectsCircle(20.000001, 0, 10, 2, 10), false);
});

test('analytical outward normals prove ellipse-circle overlap on both sides of tangency', () => {
	// Independent oracle: a boundary point plus its outward normal is the closest
	// ellipse point for every positive displacement along that normal. No collision
	// solver or discretized outline supplies the expected results.
	const axes = [0.01, 0.5, 1, 5, 14, 30, 60, 500];
	for (const halfWidth of axes) {
		for (const halfHeight of axes) {
			for (const radius of [0.5, 1, 10, 40]) {
				for (let index = 0; index <= 24; index += 1) {
					const angle = index * Math.PI / 48;
					const boundaryX = halfWidth * Math.cos(angle);
					const boundaryY = halfHeight * Math.sin(angle);
					const gradientX = Math.cos(angle) / halfWidth;
					const gradientY = Math.sin(angle) / halfHeight;
					const gradientLength = Math.hypot(gradientX, gradientY);
					const normalX = gradientX / gradientLength;
					const normalY = gradientY / gradientLength;
					for (const distance of [radius - 0.000001, radius + 0.000001]) {
						const x = boundaryX + distance * normalX;
						const y = boundaryY + distance * normalY;
						const expected = distance < radius;
						const message = `axes=${halfWidth},${halfHeight}; radius=${radius}; angle=${angle}; distance=${distance}`;
						assert.equal(contactIntersectsCircle(x, y, halfWidth, halfHeight, radius), expected, message);
						assert.equal(contactIntersectsCircle(-x, y, halfWidth, halfHeight, radius), expected, message);
						assert.equal(contactIntersectsCircle(x, -y, halfWidth, halfHeight, radius), expected, message);
						assert.equal(contactIntersectsCircle(y, x, halfHeight, halfWidth, radius), expected, message);
					}
				}
			}
		}
	}
});

test('highly anisotropic contacts converge without an arbitrary iteration limit', () => {
	for (const [halfWidth, halfHeight] of [[0.000001, 1000000], [1000000, 0.000001]]) {
		for (const angle of [0, Math.PI / 1000, Math.PI / 4, Math.PI / 2]) {
			const boundaryX = halfWidth * Math.cos(angle);
			const boundaryY = halfHeight * Math.sin(angle);
			const gradientX = Math.cos(angle) / halfWidth;
			const gradientY = Math.sin(angle) / halfHeight;
			const length = Math.hypot(gradientX, gradientY);
			for (const distance of [39.9999, 40.0001]) {
				assert.equal(contactIntersectsCircle(boundaryX + distance * gradientX / length,
					boundaryY + distance * gradientY / length, halfWidth, halfHeight, 40), distance < 40,
					`axes=${halfWidth},${halfHeight}; angle=${angle}; distance=${distance}`);
			}
		}
	}
});
