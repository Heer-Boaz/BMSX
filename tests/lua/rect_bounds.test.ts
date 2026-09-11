import assert from 'node:assert/strict';
import test from 'node:test';
import { rects_intersect } from '../../machine/ts/common/rect';

test('half-open bounds exclude touching edges while an explicit stroke margin admits them', () => {
	const clip = { left: -10, top: -4, right: 20, bottom: 12 };
	assert.equal(rects_intersect({ left: 19, top: 1, right: 30, bottom: 2 }, clip), true);
	assert.equal(rects_intersect({ left: 20, top: 1, right: 30, bottom: 2 }, clip), false);
	assert.equal(rects_intersect({ left: -20, top: -8, right: -10, bottom: -4 }, clip), false);
	assert.equal(rects_intersect({ left: -20, top: -8, right: -10, bottom: -4 }, clip, 1), true);
	assert.equal(rects_intersect({ left: -12, top: 0, right: -12, bottom: 10 }, clip, 2), false);
	assert.equal(rects_intersect({ left: -12, top: 0, right: -12, bottom: 10 }, clip, 2.5), true);
});
