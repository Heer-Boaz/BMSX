import assert from 'node:assert/strict';
import test from 'node:test';
import {
	HOST_OVERLAY_INSTANCE_FLOATS,
	HOST_OVERLAY_TEXTURE_ATLAS,
	HOST_OVERLAY_TEXTURE_SOLID,
	HostOverlayQuadStream,
} from '../../machine/ts/render/host_overlay/quad_stream';
import { HOST_SYSTEM_ATLAS } from '../../machine/ts/render/host_overlay/atlas';
import { Font, type FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { TAB_SPACES } from '../../machine/ts/render/shared/bitmap_font';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { RectRenderKind } from '../../machine/ts/render/shared/submissions';
import { IDENTITY_HOST_OVERLAY_TRANSFORM } from '../../machine/ts/render/host_overlay/transform';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';

test('host overlay quad stream emits glyph backgrounds before atlas glyphs with atlas UVs', () => {
	const stream = new HostOverlayQuadStream();
	const font = new Font();
	stream.appendEntry(Host2DKind.Glyphs, {
		x: 10,
		y: 20,
		z: 0,
		items: 'AB',
		item_start: 0,
		item_end: 2,
		font,
		color: 0xffffffff,
		has_background_color: true,
		background_color: 0xff102030,
		layer: LAYER_2D_IDE,
	});

	assert.equal(stream.count, 4);
	assert.deepEqual(Array.from(stream.textureKinds.subarray(0, 4)), [
		HOST_OVERLAY_TEXTURE_SOLID,
		HOST_OVERLAY_TEXTURE_SOLID,
		HOST_OVERLAY_TEXTURE_ATLAS,
		HOST_OVERLAY_TEXTURE_ATLAS,
	]);
	const firstGlyph = font.getGlyph('A');
	const secondGlyph = font.getGlyph('B');
	const firstGlyphBase = HOST_OVERLAY_INSTANCE_FLOATS * 2;
	const secondGlyphBase = HOST_OVERLAY_INSTANCE_FLOATS * 3;
	assert.deepEqual(Array.from(stream.floatData.subarray(firstGlyphBase, firstGlyphBase + 6)), [
		10, 20, firstGlyph.width, 0, 0, firstGlyph.height,
	]);
	assert.deepEqual(Array.from(stream.floatData.subarray(firstGlyphBase + 6, firstGlyphBase + 10)), [
		Math.fround(firstGlyph.rect.u / HOST_SYSTEM_ATLAS.width),
		Math.fround(firstGlyph.rect.v / HOST_SYSTEM_ATLAS.height),
		Math.fround((firstGlyph.rect.u + firstGlyph.rect.w) / HOST_SYSTEM_ATLAS.width),
		Math.fround((firstGlyph.rect.v + firstGlyph.rect.h) / HOST_SYSTEM_ATLAS.height),
	]);
	assert.equal(stream.floatData[secondGlyphBase], 10 + firstGlyph.advance);
	assert.equal(stream.floatData[secondGlyphBase + 2], secondGlyph.width);
});

for (const variant of ['msx', 'tiny'] satisfies FontVariant[]) {
	test(`host glyph range uses top-left coordinates and explicit tab/newline advances (${variant})`, () => {
		const font = new Font({ variant });
		const stream = new HostOverlayQuadStream();
		stream.appendEntry(Host2DKind.Glyphs, {
			x: 11, y: 17, z: 0,
			items: '_A\tB\nC_', item_start: 1, item_end: 6,
			font, color: 0xffffffff,
			has_background_color: false, background_color: 0,
			layer: LAYER_2D_IDE,
		});
		assert.equal(stream.count, 3);
		const expected = [
			[11, 17],
			[11 + font.advance('A') + TAB_SPACES * font.advance(' '), 17],
			[11, 17 + font.lineHeight],
		];
		for (let index = 0; index < expected.length; index += 1) {
			const base = index * HOST_OVERLAY_INSTANCE_FLOATS;
			assert.deepEqual(Array.from(stream.floatData.subarray(base, base + 2)), expected[index]);
			assert.equal(stream.textureKinds[index], HOST_OVERLAY_TEXTURE_ATLAS);
		}
	});
}

test('host transforms scale glyph geometry and advances, not atlas coordinates or cosmetic stroke widths', () => {
	const stream = new HostOverlayQuadStream();
	const font = new Font({ variant: 'tiny' });
	const text = { x: 2, y: 3, z: 0, items: 'A\tB\nC', item_start: 0, item_end: 5, font,
		color: 0xffffffff, has_background_color: true, background_color: 0xff223344, layer: LAYER_2D_IDE };
	stream.reset(64, 48);
	stream.appendEntry(Host2DKind.Glyphs, text);
	const original = stream.floatData.slice(0, stream.count * HOST_OVERLAY_INSTANCE_FLOATS);
	stream.reset(64, 48);
	stream.appendEntry(Host2DKind.Transform, { scale: 0.75, offsetX: 8, offsetY: 9 });
	stream.appendEntry(Host2DKind.Glyphs, text);
	assert.equal(stream.count, 6);
	for (let index = 0; index < stream.count; index += 1) {
		const base = index * HOST_OVERLAY_INSTANCE_FLOATS;
		assert.equal(stream.floatData[base], original[base] * 0.75 + 8);
		assert.equal(stream.floatData[base + 1], original[base + 1] * 0.75 + 9);
		assert.equal(stream.floatData[base + 2], original[base + 2] * 0.75);
		assert.equal(stream.floatData[base + 5], original[base + 5] * 0.75);
		assert.deepEqual(stream.floatData.subarray(base + 6, base + 10), original.subarray(base + 6, base + 10));
	}
	assert.equal(text.x, 2);
	assert.equal(font.getGlyph('A').width, original[3 * HOST_OVERLAY_INSTANCE_FLOATS + 2]);
	stream.appendEntry(Host2DKind.Rect, { kind: RectRenderKind.Rect, area: { left: 0, top: 0, right: 20, bottom: 16, z: 0 }, color: 0xffffffff, layer: LAYER_2D_IDE });
	assert.equal(stream.floatData[6 * HOST_OVERLAY_INSTANCE_FLOATS + 5], 1, 'top stroke remains one screen pixel');
	assert.equal(stream.floatData[8 * HOST_OVERLAY_INSTANCE_FLOATS + 2], 1, 'left stroke remains one screen pixel');
	stream.appendEntry(Host2DKind.Transform, IDENTITY_HOST_OVERLAY_TRANSFORM);
	stream.appendEntry(Host2DKind.Glyphs, text);
	assert.deepEqual(stream.floatData.subarray(10 * HOST_OVERLAY_INSTANCE_FLOATS, 16 * HOST_OVERLAY_INSTANCE_FLOATS), original);
	assert.equal(stream.batchCount, 1, 'transform changes bake geometry without breaking batches');
});

test('software transformed tiny glyphs reproduce each original texel at 2x, including tabs, newlines and backgrounds', () => {
	const { backend } = createHostOverlayFixture(64, 48);
	const context = backend.hostOverlayContext;
	const target = backend.framebufferPixels;
	const text = { x: 2, y: 3, z: 0, items: 'A\tB\nC', item_start: 0, item_end: 5, font: new Font({ variant: 'tiny' }),
		color: 0xffffffff, has_background_color: true, background_color: 0xff223344, layer: LAYER_2D_IDE };
	target.fill(0);
	beginHeadlessHost2D(context, target, 64, 48);
	renderHeadlessHost2DEntry(context, Host2DKind.Glyphs, text);
	const original = target.slice();
	target.fill(0);
	renderHeadlessHost2DEntry(context, Host2DKind.Transform, { scale: 2, offsetX: 0, offsetY: 0 });
	renderHeadlessHost2DEntry(context, Host2DKind.Glyphs, text);
	for (let y = 0; y < 48; y += 1) {
		for (let x = 0; x < 64; x += 1) {
			for (let channel = 0; channel < 4; channel += 1) {
				assert.equal(target[(y * 64 + x) * 4 + channel], original[((y >>> 1) * 64 + (x >>> 1)) * 4 + channel], `${x},${y}:${channel}`);
			}
		}
	}
});
