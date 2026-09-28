import { Font, type FontStyle } from '../../machine/ts/render/shared/bmsx_font';
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


test('host fonts select baked bold and italic pixels with unchanged baselines in both variants', () => {
	for (const variant of ['msx', 'tiny'] as const) {
		const normal = new Font({ variant });
		for (const style of ['bold', 'italic', 'bold-italic'] satisfies FontStyle[]) {
			const font = new Font({ variant, style });
			assert.equal(font.lineHeight, normal.lineHeight);
			for (let code = 32; code <= 126; code++) {
				const char = String.fromCharCode(code), base = normal.getGlyph(char), glyph = font.getGlyph(char);
				assert.equal(glyph.imgid, `${base.imgid}_${style}`);
				const bold = style !== 'italic', italic = style !== 'bold';
				assert.equal(glyph.width, base.width + (bold ? 1 : 0) + (italic ? (base.height - 1) >> 2 : 0));
				assert.equal(glyph.height, base.height);
				for (let y = 0; y < glyph.height; y++) {
					const row = new Uint8Array(glyph.width), shift = italic ? (base.height - 1 - y) >> 2 : 0;
					for (let x = 0; x < base.width; x++) {
						const alpha = HOST_SYSTEM_ATLAS.pixels[((base.rect.v + y) * HOST_SYSTEM_ATLAS.width + base.rect.u + x) * 4 + 3];
						row[x + shift] |= alpha;
						if (bold) row[x + shift + 1] |= alpha;
					}
					for (let x = 0; x < glyph.width; x++) {
						assert.equal(HOST_SYSTEM_ATLAS.pixels[((glyph.rect.v + y) * HOST_SYSTEM_ATLAS.width + glyph.rect.u + x) * 4 + 3], row[x], `${variant}/${style}/${char}/${x},${y}`);
					}
				}
			}
		}
	}
});
