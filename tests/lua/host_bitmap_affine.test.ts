import assert from 'node:assert/strict';
import test from 'node:test';
import { HostBitmap, type HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HOST_OVERLAY_TEXTURE_BITMAP, HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const bitmap = new HostBitmap({ width: 1, height: 1, pixels: new Uint8Array([200, 100, 50, 255]) });
const affine: HostBitmapRenderSubmission = {
	bitmap, originX: 6.5, originY: 1.5, axisXX: -4, axisXY: 0, axisYX: -2, axisYY: 4,
	u0: 0.25, v0: 1, u1: 0.75, v1: 0, color: 0x80402010,
};

test('affine bitmap commands snapshot all scalar inputs and reuse each completed command buffer', () => {
	const { renderer, queue, presenter } = createHostOverlayFixture(16, 16);
	renderer.beginFrame(presenter);
	renderer.drawBitmapAffine(bitmap, affine.originX, affine.originY, affine.axisXX, affine.axisXY,
		affine.axisYX, affine.axisYY, affine.u0, affine.v0, affine.u1, affine.v1, affine.color);
	renderer.drawBitmap(bitmap, 2, 3, 10, 13);
	renderer.endFrame();
	const first = queue.consumeOverlayFrame(), firstCommand = first.commandRefs[0] as HostBitmapRenderSubmission;
	assert.deepEqual(firstCommand, affine);
	assert.deepEqual(first.commandRefs[1], { bitmap, originX: 2, originY: 3, axisXX: 8, axisXY: 0, axisYX: 0, axisYY: 10,
		u0: 0, v0: 0, u1: 1, v1: 1, color: 0xffffffff });
	renderer.beginFrame(presenter); renderer.drawBitmap(bitmap, 0, 0, 4, 4); renderer.endFrame();
	queue.consumeOverlayFrame();
	assert.deepEqual(firstCommand, affine, 'the next published frame has separate scalar storage');
	renderer.beginFrame(presenter); renderer.drawBitmap(bitmap, 1, 1, 5, 5); renderer.endFrame();
	assert.equal(queue.consumeOverlayFrame().commandRefs[0], firstCommand, 'completed double-buffer storage is retained');
});

test('bitmap stream composes both affine basis columns while retaining UVs, tint and resource identity', () => {
	const stream = new HostOverlayQuadStream();
	stream.reset(16, 16);
	stream.appendEntry(Host2DKind.Transform, { scale: 2, offsetX: 3, offsetY: 4 });
	stream.appendEntry(Host2DKind.Bitmap, { ...affine, axisXY: 1 });
	assert.equal(stream.count, 1);
	assert.equal(stream.batches[0].bitmap, bitmap);
	assert.equal(stream.textureKinds[0], HOST_OVERLAY_TEXTURE_BITMAP);
	assert.deepEqual([...stream.floatData.subarray(0, 14)], [16, 7, -8, 2, -4, 8, 0.25, 1, 0.75, 0,
		Math.fround(64 / 255), Math.fround(32 / 255), Math.fround(16 / 255), Math.fround(128 / 255)]);
	assert.equal(bitmap.revision, 0, 'geometry is not a bitmap publication');
	stream.reset(16, 16);
	assert.equal(stream.batches[0].bitmap, undefined, 'retained batch storage does not retain retired images');
});

test('software reflected diagonal edges use screen-space top-left coverage, not local half-open coordinates', () => {
	const { backend } = createHostOverlayFixture(8, 8), context = backend.hostOverlayContext;
	const pixels = backend.framebufferPixels;
	beginHeadlessHost2D(context, pixels, 8, 8);
	renderHeadlessHost2DEntry(context, Host2DKind.Bitmap, { ...affine, u0: 0, v0: 0, u1: 1, v1: 1, color: 0xffffffff });
	const expected = ['........', '..####..', '..####..', '.####...', '.####...', '........', '........', '........'];
	// These exact sample centres lie on the geometry under test, not incidental UI coordinates.
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
		const offset = (y * 8 + x) * 4;
		assert.deepEqual([...pixels.subarray(offset, offset + 4)], expected[y][x] === '#' ? [200, 100, 50, 255] : [0, 0, 0, 0]);
	}
	pixels.fill(0);
	renderHeadlessHost2DEntry(context, Host2DKind.Bitmap, { ...affine, axisXX: 2, axisXY: 4, axisYX: 1, axisYY: 2 });
	assert.ok(pixels.every(value => value === 0), 'singular basis has no fragments');
});
