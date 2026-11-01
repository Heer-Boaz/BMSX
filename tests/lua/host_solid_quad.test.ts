import assert from 'node:assert/strict';
import test from 'node:test';
import { OverlayApi } from '../../ide/runtime/overlay_api';
import { Host2DKind, type HostSolidQuadRenderSubmission } from '../../machine/ts/render/host_overlay/commands';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { HOST_OVERLAY_TEXTURE_SOLID, HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const quad: HostSolidQuadRenderSubmission = {
	originX: 6.5, originY: 1.5, axisXX: -4, axisXY: 0, axisYX: -2, axisYY: 4, color: 0xffc86432,
};

test('solid affine API retains raw source color and reuses double-buffered command storage', () => {
	const { renderer, queue, presenter } = createHostOverlayFixture(16, 16), api = new OverlayApi();
	renderer.beginFrame(presenter); api.beginFrame(renderer);
	api.fillQuadColor(quad.originX, quad.originY, quad.axisXX, quad.axisXY, quad.axisYX, quad.axisYY, quad.color);
	renderer.endFrame();
	const first = queue.consumeOverlayFrame(), command = first.commandRefs[0];
	assert.equal(first.commandCount, 1); assert.equal(first.commandKinds[0], Host2DKind.SolidQuad);
	assert.deepEqual(command, quad);
	renderer.beginFrame(presenter); api.fillQuadColor(1, 2, 3, 4, 5, 6, 0x80102030); renderer.endFrame();
	const second = queue.consumeOverlayFrame();
	assert.notEqual(second.commandRefs[0], command); assert.deepEqual(command, quad);
	renderer.beginFrame(presenter); api.fillQuadColor(2, 3, 4, 5, 6, 7, 0xff123456); renderer.endFrame();
	assert.ok(queue.consumeOverlayFrame().commandRefs[0] === command, 'completed command storage is pooled');
});

test('solid affine stream composes the existing transform, clip and unit-quad format without a texture resource', () => {
	const stream = new HostOverlayQuadStream(), floats = stream.floatData;
	const clip = { left: 3, top: 4, right: 11, bottom: 12 };
	stream.reset(16, 16); stream.appendEntry(Host2DKind.Clip, clip);
	stream.appendEntry(Host2DKind.Transform, { scale: 2, offsetX: 3, offsetY: 4 });
	stream.appendEntry(Host2DKind.SolidQuad, { ...quad, axisXY: 1, color: 0x80402010 });
	assert.equal(stream.count, 1); assert.equal(stream.textureKinds[0], HOST_OVERLAY_TEXTURE_SOLID);
	assert.deepEqual([...stream.floatData.subarray(0, 14)], [16, 7, -8, 2, -4, 8, 0, 0, 1, 1,
		Math.fround(64 / 255), Math.fround(32 / 255), Math.fround(16 / 255), Math.fround(128 / 255)]);
	assert.ok(stream.batches[0].clip === clip); assert.equal(stream.batches[0].bitmap, undefined);
	assert.equal(stream.batches[0].scene, undefined);
	stream.reset(16, 16); stream.appendEntry(Host2DKind.SolidQuad, quad);
	assert.ok(stream.floatData === floats); assert.equal(stream.batchCount, 1);
	assert.equal(stream.floatData[0], quad.originX);
});

test('solid reflected diagonal edges obey exact screen-space top-left coverage and singular quads emit no fragments', () => {
	const { backend } = createHostOverlayFixture(8, 8), context = backend.hostOverlayContext, pixels = backend.framebufferPixels;
	beginHeadlessHost2D(context, pixels, 8, 8); renderHeadlessHost2DEntry(context, Host2DKind.SolidQuad, quad);
	const expected = ['........', '..####..', '..####..', '.####...', '.####...', '........', '........', '........'];
	// Pixel centres and winding are the actual raster contract, not UI geometry.
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
		const offset = (y * 8 + x) * 4;
		assert.deepEqual([...pixels.subarray(offset, offset + 4)], expected[y][x] === '#' ? [200, 100, 50, 255] : [0, 0, 0, 0]);
	}
	pixels.fill(0);
	renderHeadlessHost2DEntry(context, Host2DKind.SolidQuad, { ...quad, axisXX: 2, axisXY: 4, axisYX: 1, axisYY: 2 });
	assert.ok(pixels.every(channel => channel === 0));
});

test('solid affine coverage matches bitmap geometry across reflection, shear, fractional edges, transform and clipping', () => {
	const { backend } = createHostOverlayFixture(16, 16), context = backend.hostOverlayContext, pixels = backend.framebufferPixels;
	const bitmap = new HostBitmap({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) });
	const coverage = context.affineQuad;
	for (const geometry of [quad,
		{ ...quad, originX: 2.25, originY: 3.75, axisXX: 5.5, axisXY: 1.25, axisYX: 2.5, axisYY: 4.5 },
		{ ...quad, originX: -2, originY: 8, axisXX: 3, axisXY: -6, axisYX: 4, axisYY: 0 },
		{ ...quad, originX: 8.5, originY: 9.5, axisXX: -7, axisXY: 0, axisYX: 0, axisYY: -6 }]) {
		pixels.fill(0); beginHeadlessHost2D(context, pixels, 16, 16);
		renderHeadlessHost2DEntry(context, Host2DKind.Transform, { scale: 1.5, offsetX: 2, offsetY: 1 });
		renderHeadlessHost2DEntry(context, Host2DKind.Clip, { left: 3, top: 2, right: 12, bottom: 13 });
		renderHeadlessHost2DEntry(context, Host2DKind.SolidQuad, { ...geometry, color: 0x80402010 });
		const expected = pixels.slice(); pixels.fill(0);
		renderHeadlessHost2DEntry(context, Host2DKind.Bitmap, { ...geometry, bitmap, u0: 0, v0: 0, u1: 1, v1: 1, color: 0x80402010 });
		assert.deepEqual(pixels, expected);
		assert.ok(context.affineQuad === coverage, 'both consumers reuse the context-owned coverage scratch');
	}
});
