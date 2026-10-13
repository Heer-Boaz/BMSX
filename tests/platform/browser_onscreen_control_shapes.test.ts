import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutShoulderOutline } from '../../hosts/browser/onscreen_control_shapes';
import { contactIntersectsRoundedCircularArc, pointDistanceToRoundedCircularArc,
	type RoundedCircularArc } from '../../hosts/browser/touch_geometry';

function createArc(): RoundedCircularArc {
	return {
		centerX: 0, centerY: 0, radius: 0, halfWidth: 0,
		startX: 0, startY: 0, endX: 0, endY: 0, quarterTurns: 0,
		startT: 0, endT: 0, left: 0, top: 0, right: 0, bottom: 0,
	};
}

test('adjacent shoulders share one circular band and retain a real gap between rounded ends', () => {
	const radius = 130;
	const halfWidth = 28;
	const gap = 12;
	const halfAngle = Math.asin((90 - halfWidth) / radius);
	const gapAngle = Math.asin((halfWidth + gap / 2) / radius);
	const upward = -Math.PI / 2;
	const first = createArc();
	const second = createArc();
	layoutShoulderOutline(first, radius, halfWidth, upward - halfAngle, upward - gapAngle);
	layoutShoulderOutline(second, radius, halfWidth, upward + gapAngle, upward + halfAngle);
	assert.equal(first.radius, second.radius);
	assert.equal(first.halfWidth, second.halfWidth);
	assert.ok(Math.abs(first.centerY - second.centerY) < 1e-12, 'label points occupy the same hand row');
	const firstLeft = first.left - first.centerX;
	const firstRight = first.right - first.centerX;
	const secondLeft = second.left - second.centerX;
	const secondRight = second.right - second.centerX;
	assert.ok(Math.abs(firstLeft + 90) < 1e-12);
	assert.ok(Math.abs(secondRight - 90) < 1e-12);
	assert.ok(Math.abs(secondLeft - firstRight - gap) < 1e-12);
	assert.equal(contactIntersectsRoundedCircularArc(first.centerX, first.centerY - radius, 0, 0, first), false,
		'the gap is not made into a button by the enclosing circle');
	assert.equal(contactIntersectsRoundedCircularArc(second.centerX, second.centerY - radius, 0, 0, second), false);
});

test('finite arc producer computes exact midpoint labels, rounded bounds and singularity-free queries for every orientation', () => {
	const radius = 120;
	const halfWidth = 22;
	for (const middle of [-Math.PI, -2.5, -Math.PI / 2, -0.3, 0, 0.7, Math.PI / 2, 2.8, Math.PI]) {
		for (const sweep of [0.12, 0.4, 1.2, 2.7]) {
			const start = middle - sweep / 2;
			const end = middle + sweep / 2;
			const shape = createArc();
			const path = layoutShoulderOutline(shape, radius, halfWidth, start, end);
			assert.ok(path.startsWith('M ') && path.endsWith(' Z'));
			assert.ok(Math.abs(shape.centerX + radius * Math.cos(middle)) < 1e-12);
			assert.ok(Math.abs(shape.centerY + radius * Math.sin(middle)) < 1e-12);
			assert.equal(pointDistanceToRoundedCircularArc(0, 0, shape), 0,
				'the label belongs to its own curved contact surface');
			assert.ok(shape.startT < shape.endT, 'the rational query remains a finite ordered interval');
			const xs = [radius * Math.cos(start), radius * Math.cos(end)];
			const ys = [radius * Math.sin(start), radius * Math.sin(end)];
			for (const cardinal of [-Math.PI * 2, -Math.PI * 1.5, -Math.PI, -Math.PI / 2, 0,
				Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
				if (cardinal >= start && cardinal <= end) {
					xs.push(radius * Math.cos(cardinal));
					ys.push(radius * Math.sin(cardinal));
				}
			}
			assert.ok(Math.abs(shape.left - (shape.centerX + Math.min(...xs) - halfWidth)) < 1e-12);
			assert.ok(Math.abs(shape.right - (shape.centerX + Math.max(...xs) + halfWidth)) < 1e-12);
			assert.ok(Math.abs(shape.top - (shape.centerY + Math.min(...ys) - halfWidth)) < 1e-12);
			assert.ok(Math.abs(shape.bottom - (shape.centerY + Math.max(...ys) + halfWidth)) < 1e-12);
		}
	}
});

test('split and rotated arc SVG producers retain analytical anisotropic support contacts', () => {
	for (const middle of [-Math.PI, -2.5, -Math.PI / 2, -0.3, 0, 0.7, Math.PI / 2, 2.8, Math.PI]) {
		const shape = createArc();
		layoutShoulderOutline(shape, 120, 22, middle - 0.23, middle + 0.23);
		for (const angle of [middle - 0.2, middle, middle + 0.2]) {
			const nx = Math.cos(angle);
			const ny = Math.sin(angle);
			for (const [a, b] of [[3, 14], [14, 3], [0.5, 28], [28, 0.5]]) {
				const support = Math.hypot(a * nx, b * ny);
				const sx = a * a * nx / support;
				const sy = b * b * ny / support;
				for (const offset of [-0.000001, 0.000001]) {
					assert.equal(contactIntersectsRoundedCircularArc(
						shape.centerX + (shape.radius + shape.halfWidth + offset) * nx + sx,
						shape.centerY + (shape.radius + shape.halfWidth + offset) * ny + sy, a, b, shape), offset < 0,
						`middle=${middle}, angle=${angle}, axes=${a},${b}, offset=${offset}`);
				}
			}
		}
	}
});
