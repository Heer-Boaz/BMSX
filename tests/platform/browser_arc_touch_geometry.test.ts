import assert from 'node:assert/strict';
import test from 'node:test';
import { contactIntersectsRoundedCircularArc, pointDistanceToRoundedCircularArc,
	type RoundedCircularArc } from '../../hosts/browser/touch_geometry';

function makeArc(quarterTurns: 0 | 1 | 2 | 3 = 0, halfAngle = 0.5, radius = 100, halfWidth = 18): RoundedCircularArc {
	const angle = -Math.PI / 2 + quarterTurns * Math.PI / 2;
	const bound = radius + halfWidth;
	return {
		centerX: 0, centerY: 0, radius, halfWidth,
		startX: Math.cos(angle - halfAngle), startY: Math.sin(angle - halfAngle),
		endX: Math.cos(angle + halfAngle), endY: Math.sin(angle + halfAngle),
		quarterTurns, startT: Math.tan((-Math.PI / 2 - halfAngle) / 2), endT: Math.tan((-Math.PI / 2 + halfAngle) / 2),
		left: -bound, top: -bound, right: bound, bottom: bound,
	};
}

const arc = makeArc();

test('point distance follows a curved finite band, leaving its inner hole and bounding corners empty', () => {
	assert.equal(pointDistanceToRoundedCircularArc(0, -100, arc), 0);
	assert.equal(pointDistanceToRoundedCircularArc(0, -82, arc), 0);
	assert.equal(pointDistanceToRoundedCircularArc(0, -118, arc), 0);
	assert.equal(pointDistanceToRoundedCircularArc(0, -81, arc), 1);
	assert.equal(pointDistanceToRoundedCircularArc(0, -119, arc), 1);
	assert.equal(pointDistanceToRoundedCircularArc(0, 0, arc), 82);
	assert.equal(contactIntersectsRoundedCircularArc(0, 0, 14, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(80, -110, 14, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(100, 0, 0, 0, arc), false,
		'the finite arc does not extend around the rest of its parent circle');
});

test('circular footprints dilate both concentric boundaries, with inclusive cardinal tangencies', () => {
	assert.equal(contactIntersectsRoundedCircularArc(0, -132, 14, 14, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, -132.000001, 14, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(0, -68, 14, 14, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, -67.999999, 14, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(0, 0, 82, 82, arc), true,
		'a circle may reach the band from inside the empty hole');
});

test('finite rounded endpoints accept ellipse and line footprints without extending the arc', () => {
	for (const sign of [-1, 1]) {
		const endpointX = sign * arc.radius * Math.sin(0.5);
		const endpointY = -arc.radius * Math.cos(0.5);
		assert.equal(contactIntersectsRoundedCircularArc(endpointX + sign * 31.999999, endpointY, 14, 3, arc), true);
		assert.equal(contactIntersectsRoundedCircularArc(endpointX + sign * 32.000001, endpointY, 14, 3, arc), false);
		assert.equal(contactIntersectsRoundedCircularArc(endpointX + sign * 31.999999, endpointY, 14, 0, arc), true);
		assert.equal(contactIntersectsRoundedCircularArc(endpointX + sign * 32.000001, endpointY, 14, 0, arc), false);
	}
});

test('ellipse containment, band containment and anisotropic cardinal tangencies are distinguished', () => {
	assert.equal(contactIntersectsRoundedCircularArc(0, -100, 3, 2, arc), true,
		'a small ellipse contained in the band need not cross either arc boundary');
	assert.equal(contactIntersectsRoundedCircularArc(0, 0, 140, 120, arc), true,
		'an ellipse containing the whole band still intersects it');
	assert.equal(contactIntersectsRoundedCircularArc(0, 0, 70, 70.5, arc), false,
		'an ellipse contained in the inner hole is not a hit');
	assert.equal(contactIntersectsRoundedCircularArc(0, -132, 3, 14, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, -132.000001, 3, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(0, -68, 3, 14, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, -67.999999, 3, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(0, -100, 0, 100, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, 0, 100, 0, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(0, -132, 0, 14, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, -132.000001, 0, 14, arc), false);
	assert.equal(contactIntersectsRoundedCircularArc(0, -118, 14, 0, arc), true);
	assert.equal(contactIntersectsRoundedCircularArc(0, -118.000001, 14, 0, arc), false);
});

test('quarter-turn projections preserve axis-aligned ellipse contacts for every orientation', () => {
	for (const rotation of [0, 1, 2, 3] as const) {
		const shape = makeArc(rotation);
		const nx = rotation === 1 ? 1 : rotation === 3 ? -1 : 0;
		const ny = rotation === 0 ? -1 : rotation === 2 ? 1 : 0;
		const a = nx === 0 ? 3 : 14;
		const b = ny === 0 ? 3 : 14;
		assert.equal(contactIntersectsRoundedCircularArc(nx * 132, ny * 132, a, b, shape), true);
		assert.equal(contactIntersectsRoundedCircularArc(nx * 132.000001, ny * 132.000001, a, b, shape), false);
		assert.equal(contactIntersectsRoundedCircularArc(nx * 68, ny * 68, a, b, shape), true);
		assert.equal(contactIntersectsRoundedCircularArc(nx * 67.999999, ny * 67.999999, a, b, shape), false);
	}
});

test('analytical common normals prove both sides of outer-arc ellipse tangency', () => {
	// The outer band is contained in the radius R+h disk. Its supporting point
	// plus the ellipse's support vector is an independent external tangency.
	for (const rotation of [0, 1, 2, 3] as const) {
		const shape = makeArc(rotation);
		for (const angleOffset of [-0.4, -0.2, 0, 0.2, 0.4]) {
			const angle = -Math.PI / 2 + rotation * Math.PI / 2 + angleOffset;
			const nx = Math.cos(angle);
			const ny = Math.sin(angle);
			for (const [a, b] of [[3, 14], [14, 3], [0.5, 28], [28, 0.5], [1000000, 0.000001], [0.000001, 1000000]]) {
				const support = Math.hypot(a * nx, b * ny);
				const supportX = a * a * nx / support;
				const supportY = b * b * ny / support;
				for (const offset of [-0.00001, 0.00001]) {
					const x = (shape.radius + shape.halfWidth + offset) * nx + supportX;
					const y = (shape.radius + shape.halfWidth + offset) * ny + supportY;
					assert.equal(contactIntersectsRoundedCircularArc(x, y, a, b, shape), offset < 0,
						`rotation=${rotation}, angle=${angleOffset}, axes=${a},${b}, offset=${offset}`);
				}
			}
		}
	}
});

test('the concave inner arc accepts near tangency and rejects ellipses confined to its hole', () => {
	for (const angle of [-1.9, -1.7, -1.5, -1.3]) {
		const nx = Math.cos(angle);
		const ny = Math.sin(angle);
		for (const [a, b] of [[3, 6], [6, 3]]) {
			const support = Math.hypot(a * nx, b * ny);
			const sx = a * a * nx / support;
			const sy = b * b * ny / support;
			for (const offset of [-0.000001, 0.000001]) {
				const x = (arc.radius - arc.halfWidth - offset) * nx - sx;
				const y = (arc.radius - arc.halfWidth - offset) * ny - sy;
				assert.equal(contactIntersectsRoundedCircularArc(x, y, a, b, arc), offset < 0,
					`angle=${angle}, axes=${a},${b}, offset=${offset}`);
			}
		}
	}
});

test('translated label coordinates and tight authored bounds retain the same curved surface', () => {
	const shape = { ...arc, centerX: 30, centerY: 100,
		left: 30 - 100 * Math.sin(0.5) - 18, right: 30 + 100 * Math.sin(0.5) + 18,
		top: -18, bottom: 100 - 100 * Math.cos(0.5) + 18 };
	assert.equal(contactIntersectsRoundedCircularArc(30, 0, 14, 3, shape), true);
	assert.equal(contactIntersectsRoundedCircularArc(30, -32, 3, 14, shape), true);
	assert.equal(contactIntersectsRoundedCircularArc(30, -32.000001, 3, 14, shape), false);
	assert.equal(contactIntersectsRoundedCircularArc(30, 100, 14, 3, shape), false);
});

test('seeded independent support normals cover varied authored arc and footprint sizes', () => {
	let seed = 0x42534d58;
	const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
	for (let sample = 0; sample < 1000; sample += 1) {
		const halfAngle = 0.15 + 0.6 * random();
		const radius = 40 + 200 * random();
		const halfWidth = 2 + 28 * random();
		const shape = makeArc(0, halfAngle, radius, halfWidth);
		const angle = -Math.PI / 2 + (random() * 2 - 1) * halfAngle * 0.9;
		const a = 0.01 + 60 * random();
		const b = 0.01 + 60 * random();
		const nx = Math.cos(angle);
		const ny = Math.sin(angle);
		const support = Math.hypot(a * nx, b * ny);
		const sx = a * a * nx / support;
		const sy = b * b * ny / support;
		for (const offset of [-0.000001, 0.000001]) {
			assert.equal(contactIntersectsRoundedCircularArc((radius + halfWidth + offset) * nx + sx,
				(radius + halfWidth + offset) * ny + sy, a, b, shape), offset < 0,
				`sample=${sample}, angle=${angle}, axes=${a},${b}, offset=${offset}`);
		}
	}
});
