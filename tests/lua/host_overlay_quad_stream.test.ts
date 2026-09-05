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
		const font = new Font(variant);
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
