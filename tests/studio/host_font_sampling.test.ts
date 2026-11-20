import assert from 'node:assert/strict';
import test from 'node:test';
import { HOST_SYSTEM_ATLAS } from '../../machine/ts/render/host_overlay/atlas';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { createHostOverlayFixture } from '../helpers/host_overlay';

test('host atlas entries have transparent filtering gutters without changing their authored extent', () => {
	const { width, pixels, images } = HOST_SYSTEM_ATLAS;
	for (const image of images) {
		assert.equal(image.width, image.w); assert.equal(image.height, image.h);
		for (let x = image.u - 1; x <= image.u + image.w; x++) {
			assert.equal(pixels[((image.v - 1) * width + x) * 4 + 3], 0);
			assert.equal(pixels[((image.v + image.h) * width + x) * 4 + 3], 0);
		}
		for (let y = image.v; y < image.v + image.h; y++) {
			assert.equal(pixels[(y * width + image.u - 1) * 4 + 3], 0);
			assert.equal(pixels[(y * width + image.u + image.w) * 4 + 3], 0);
		}
	}
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} smooth coverage preserves metrics, tint and clipping; nearest remains exact`, () => {
	const f = createHostOverlayFixture(80, 60);
	const sharp = new Font({ variant }), smooth = new Font({ variant, sampling: 'linear' });
	assert.equal(sharp.measure('A\tB'), smooth.measure('A\tB')); assert.equal(sharp.lineHeight, smooth.lineHeight);
	const draw = (font: Font, scale: number, clipped: boolean) => {
		f.backend.framebufferPixels.fill(0);
		f.renderer.beginFrame();
		if (clipped) f.renderer.pushClipRect(10, 8, 50, 42);
		f.renderer.pushTransform({ scale, offsetX: 0, offsetY: 0 });
		f.renderer.itemRun('Ay', 0, 2, 2, 2, 0, font, 0xffff0000, 0);
		f.renderer.popTransform();
		if (clipped) f.renderer.popClipRect();
		f.renderer.endFrame();
		const frame = f.queue.consumeOverlayFrame();
		beginHeadlessHost2D(f.backend.hostOverlayContext, f.backend.framebufferPixels, 80, 60, 80, 60);
		for (let i = 0; i < frame.commandCount; i++) renderHeadlessHost2DEntry(f.backend.hostOverlayContext, frame.commandKinds[i], frame.commandRefs[i]);
		return f.backend.framebufferPixels.slice();
	};
	assert.deepEqual(draw(smooth, 1, false), draw(sharp, 1, false), 'aligned 1:1 filtering reproduces original coverage');
	const filtered = draw(smooth, 3, false), nearest = draw(sharp, 3, false), clipped = draw(smooth, 3, true);
	let fractional = 0;
	for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) {
		const offset = (y * 80 + x) * 4, alpha = filtered[offset + 3];
		if (alpha > 0 && alpha < 255) fractional++;
		assert.equal(filtered[offset], alpha, 'coverage modulates the requested red once, without black fringes');
		assert.equal(filtered[offset + 1], 0); assert.equal(filtered[offset + 2], 0);
		assert.ok(nearest[offset + 3] === 0 || nearest[offset + 3] === 255);
		assert.equal(clipped[offset + 3], x >= 10 && x < 50 && y >= 8 && y < 42 ? alpha : 0);
	}
	assert.ok(fractional > 0);
});
