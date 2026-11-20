import { Font } from '../../machine/ts/render/shared/bmsx_font';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	HOST_SYSTEM_ATLAS,
	hostSystemAtlasImage,
} from '../../machine/ts/render/host_overlay/atlas';

test('host system atlas exposes generated native RGBA bytes', () => {
	const pixels = HOST_SYSTEM_ATLAS.pixels;
	const whitePixel = hostSystemAtlasImage('whitepixel');
	const whitePixelOffset = (whitePixel.v * HOST_SYSTEM_ATLAS.width + whitePixel.u) * 4;

	assert.equal(pixels.byteLength, HOST_SYSTEM_ATLAS.width * HOST_SYSTEM_ATLAS.height * 4);
	assert.deepEqual(Array.from(pixels.subarray(whitePixelOffset, whitePixelOffset + 4)), [255, 255, 255, 255]);
	for (let index = 1; index < HOST_SYSTEM_ATLAS.images.length; index += 1) {
		assert.ok(HOST_SYSTEM_ATLAS.images[index - 1].id < HOST_SYSTEM_ATLAS.images[index].id);
	}
});

test('host system atlas image lookup is strict', () => {
	assert.equal(hostSystemAtlasImage('whitepixel').width, 1);
	assert.throws(() => hostSystemAtlasImage('missing_host_atlas_image'), /not in the host system atlas/);
});

test('both host fonts have a compact native ellipsis glyph, including italic text', () => {
	for (const variant of ['msx', 'tiny'] as const) {
		for (const style of ['normal', 'italic'] as const) {
			const font = new Font({ variant, style }), glyph = font.getGlyph('…');
			assert.notEqual(glyph.imgid, font.getGlyph('?').imgid);
			assert.match(glyph.imgid, /_ellipsis(?:_italic)?$/);
			assert.equal(glyph.height, font.lineHeight);
			assert.ok(glyph.advance < font.advance('.') * 3);
			let opaque = 0;
			for (let y = 0; y < glyph.height; y++) {
				for (let x = 0; x < glyph.width; x++) {
					const alpha = HOST_SYSTEM_ATLAS.pixels[((glyph.rect.v + y) * HOST_SYSTEM_ATLAS.width + glyph.rect.u + x) * 4 + 3];
					if (alpha !== 0) opaque++;
				}
			}
			assert.equal(opaque, 3, 'one atlas glyph contains the three dots; rendering never expands them into characters');
			assert.equal(font.getGlyph('…'), glyph, 'glyph geometry is retained');
		}
	}
});

for (const variant of ['msx', 'tiny'] as const) for (const style of ['normal', 'italic'] as const) {
	test(`${variant} ${style} middle dot resolves one centered native atlas pixel without changing unknown fallback`, () => {
		const normal = new Font({ variant }), cell = normal.getGlyph('.');
		const font = new Font({ variant, style }), glyph = font.getGlyph('·'), fallback = font.getGlyph('?');
		assert.notEqual(glyph.imgid, fallback.imgid);
		assert.equal(glyph.width, cell.width + (style === 'italic' ? (cell.height - 1) >> 2 : 0));
		assert.equal(glyph.height, cell.height); assert.equal(glyph.height, font.lineHeight);
		assert.equal(glyph.advance, font.advance('.'));
		// This is the native bitmap contract, independent of atlas packing or UI placement.
		const dotY = (cell.height - 2) >> 1;
		const dotX = ((cell.width - 1) >> 1) + (style === 'italic' ? (cell.height - 1 - dotY) >> 2 : 0);
		for (let y = 0; y < glyph.height; y++) for (let x = 0; x < glyph.width; x++) {
			const offset = ((glyph.rect.v + y) * HOST_SYSTEM_ATLAS.width + glyph.rect.u + x) * 4;
			assert.equal(HOST_SYSTEM_ATLAS.pixels[offset + 3], x === dotX && y === dotY ? 255 : 0);
			if (x === dotX && y === dotY) assert.deepEqual(Array.from(HOST_SYSTEM_ATLAS.pixels.subarray(offset, offset + 3)), [255, 255, 255]);
		}
		assert.equal(font.measure('·'), glyph.advance);
		assert.equal(font.measure('A·B'), font.advance('A') + glyph.advance + font.advance('B'));
		assert.ok(font.getGlyph('·') === glyph, 'middle-dot atlas geometry is retained across text measurement');
		const unknown = font.getGlyph('☃');
		assert.equal(unknown.imgid, fallback.imgid); assert.deepEqual(unknown.rect, fallback.rect); assert.equal(unknown.advance, fallback.advance);
		assert.equal(font.measure('A☃B'), font.advance('A') + fallback.advance + font.advance('B'));
	});
}


test('host italic glyphs preserve the baseline and contain the sheared source pixels in both variants', () => {
	for (const variant of ['msx', 'tiny'] as const) {
		const normal = new Font({ variant }), font = new Font({ variant, style: 'italic' });
		assert.equal(font.lineHeight, normal.lineHeight);
		for (let code = 32; code <= 126; code++) {
			const char = String.fromCharCode(code), base = normal.getGlyph(char), glyph = font.getGlyph(char);
			assert.equal(glyph.width, base.width + ((base.height - 1) >> 2));
			assert.equal(glyph.height, base.height);
			for (let y = 0; y < glyph.height; y++) {
				const row = new Uint8Array(glyph.width), shift = (base.height - 1 - y) >> 2;
				for (let x = 0; x < base.width; x++) {
					row[x + shift] = HOST_SYSTEM_ATLAS.pixels[((base.rect.v + y) * HOST_SYSTEM_ATLAS.width + base.rect.u + x) * 4 + 3];
				}
				for (let x = 0; x < glyph.width; x++) {
					assert.equal(HOST_SYSTEM_ATLAS.pixels[((glyph.rect.v + y) * HOST_SYSTEM_ATLAS.width + glyph.rect.u + x) * 4 + 3], row[x]);
				}
			}
		}
	}
});
