import assert from 'node:assert/strict';
import test from 'node:test';
import { ActorRenderFrame } from '../../ide/workbench/contrib/actor_lab/render_geometry';
import { ActorViewportPicker } from '../../ide/workbench/contrib/actor_lab/viewport_pick';

// These are draw-geometry contracts, not UI geometry snapshots. Actual compiled
// cartlib/CPU/device/presentation ownership is exercised by actor_render_frames.
test('published visual picking follows draw order, cropping, negative scale and domain', () => {
	const frame = new ActorRenderFrame(); frame.sequence = 17;
	Object.assign(frame.quads.get(0), { domain: 0, hashId: 1, label: 'back', ox: 0, oy: 0, ax: 32, ay: 0, bx: 0, by: 24 });
	Object.assign(frame.quads.get(1), { domain: 0, hashId: 2, label: 'front', ox: 16, oy: 8, ax: -12, ay: 0, bx: 0, by: 3 });
	Object.assign(frame.quads.get(2), { domain: 1, hashId: 3, label: 'other socket', ox: 0, oy: 0, ax: 32, ay: 0, bx: 0, by: 24 });
	const picker = new ActorViewportPicker(frame), hit = picker.pick(0, 17, 8, 9)!;
	assert.equal(hit.hashId, 2);
	assert.deepEqual([hit.left, hit.top, hit.right, hit.bottom], [4, 8, 16, 11]);
	for (let i = 0; i < 1000; i++) assert.equal(picker.pick(0, 17, 8, 9), hit);
	assert.equal(picker.pick(0, 17, 0, 9)?.hashId, 1);
	assert.equal(picker.pick(0, 17, 128, 128), undefined);
	assert.equal(picker.pick(1, 17, 8, 9)?.hashId, 3);
	assert.equal(picker.pick(0, undefined, 8, 9), undefined);
	assert.equal(picker.pick(0, 18, 8, 9), undefined);
});

test('published affine picking rejects empty corners and singular planes, and advances only with the image', () => {
	const frame = new ActorRenderFrame(); frame.sequence = 1;
	const quad = frame.quads.get(0);
	Object.assign(quad, { domain: 0, hashId: 1, label: 'sheared', ox: 33, oy: 17, ax: 0, ay: 4, bx: -4, by: 6 });
	const picker = new ActorViewportPicker(frame);
	assert.ok(picker.pick(0, 1, 31, 22));
	assert.equal(picker.pick(0, 1, 29.2, 17.2), undefined);
	frame.offsetX = 10; frame.offsetY = 5; frame.sequence = 2;
	assert.equal(picker.pick(0, 1, 31, 22), undefined, 'an older bitmap cannot borrow newer geometry');
	assert.equal(picker.pick(0, 2, 31, 22), undefined);
	assert.ok(picker.pick(0, 2, 41, 27));
	quad.ax = 0; quad.ay = 0; frame.sequence = 3;
	assert.equal(picker.pick(0, 3, 41, 27), undefined);
});
