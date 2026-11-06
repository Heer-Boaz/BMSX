import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { forEachBatchBlitGlyph } from '../../machine/ts/render/shared/glyph_runs';
import { HostOverlayQuadStream, HOST_OVERLAY_INSTANCE_FLOATS, HOST_OVERLAY_TEXTURE_GLYPH_MSDF } from '../../machine/ts/render/host_overlay/quad_stream';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { createHostOverlayFixture } from '../helpers/host_overlay';

for (const style of ['normal', 'italic'] as const) test(`scalable ${style} glyph layout keeps baseline, advance and ink extent independent`, () => {
	const font = new Font({ variant: 'mono', style });
	assert.equal(font.raster, 'msdf'); assert.equal(font.sampling, 'linear');
	assert.equal(font.getGlyph(' ').width, 0, 'space has advance but no ink quad');
	const advance = font.advance(' ');
	for (const char of 'AgÁé€.…') assert.equal(font.advance(char), advance, 'monospace source advances survive atlas packing');
	assert.notEqual(font.getGlyph('Á').imgid, font.getGlyph('?').imgid);
	assert.equal(font.getGlyph('g'), font.getGlyph('g'), 'resolved glyphs are retained');
	assert.ok(font.getGlyph('g').offsetY > font.getGlyph('Á').offsetY, 'cap accents and descenders share one baseline, not individual top alignment');
	assert.ok(font.getGlyph('g').offsetY + font.getGlyph('g').height > font.getGlyph('A').offsetY + font.getGlyph('A').height);
	assert.notEqual(font.getGlyph('A').width, font.advance('A'), 'distance-field padding is not text spacing');
	assert.equal(font.textWidth('A g'), advance * 3, 'line width includes spaces and excludes atlas padding');
	assert.equal(font.measure('A\tÁ\ng'), advance * 5);
	const command = { x: 2.25, y: 3.5, z: 0, items: 'A \tg\nÁ', item_start: 0, item_end: 6,
		font, color: 0xffffffff, has_background_color: true, background_color: 0xff203040, layer: LAYER_2D_IDE };
	const pens: number[][] = [];
	forEachBatchBlitGlyph(command, pens, (pens, _glyph, x, y) => pens.push([x, y]));
	assert.deepEqual(pens, [[2.25, 3.5], [2.25 + advance, 3.5], [2.25 + advance * 4, 3.5], [2.25, 3.5 + font.lineHeight]]);
	const stream = new HostOverlayQuadStream();
	stream.reset(80, 60);
	stream.appendEntry(Host2DKind.Transform, { scale: 2, offsetX: 4, offsetY: 1 });
	stream.appendEntry(Host2DKind.Glyphs, command);
	assert.equal(stream.count, 7, 'four advance-cell backgrounds, three nonempty ink quads');
	const a = font.getGlyph('A'), base = 4 * HOST_OVERLAY_INSTANCE_FLOATS;
	assert.equal(stream.textureKinds[4], HOST_OVERLAY_TEXTURE_GLYPH_MSDF);
	assert.equal(stream.floatData[base], Math.fround((command.x + a.offsetX) * 2 + 4));
	assert.equal(stream.floatData[base + 1], Math.fround((command.y + a.offsetY) * 2 + 1));
	assert.equal(stream.floatData[base + 14], font.distanceRange * 2, 'coverage scale follows the glyph transform');
});

test('software scalable glyphs use physical raster density, fractional pens, tint and clipping', () => {
	const f = createHostOverlayFixture(160, 120), font = new Font({ variant: 'mono' });
	const command = { x: 1.25, y: 2.5, z: 0, items: 'Ag', item_start: 0, item_end: 2, font,
		color: 0xffff0000, has_background_color: false, background_color: 0, layer: LAYER_2D_IDE };
	const draw = (density: number, scale: number, clipped: boolean) => {
		f.backend.framebufferPixels.fill(0);
		const context = f.backend.hostOverlayContext;
		beginHeadlessHost2D(context, f.backend.framebufferPixels, 160, 120, 160 / density, 120 / density);
		renderHeadlessHost2DEntry(context, Host2DKind.Transform, { scale, offsetX: 0, offsetY: 0 });
		if (clipped) renderHeadlessHost2DEntry(context, Host2DKind.Clip, { left: 10, top: 8, right: 30, bottom: 30 });
		renderHeadlessHost2DEntry(context, Host2DKind.Glyphs, command);
		return f.backend.framebufferPixels.slice();
	};
	const raster = draw(3, 1, false);
	assert.deepEqual(raster, draw(1, 3, false), 'display density and explicit text scaling resolve the same contours');
	const clipped = draw(3, 1, true);
	let edges = 0, ink = 0;
	for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) {
		const i = (y * 160 + x) * 4, alpha = raster[i + 3];
		assert.equal(raster[i], alpha); assert.equal(raster[i + 1], 0); assert.equal(raster[i + 2], 0);
		assert.equal(clipped[i + 3], x >= 30 && y >= 24 && x < 90 && y < 90 ? alpha : 0);
		if (alpha === 255) ink++;
		else if (alpha > 0) edges++;
	}
	assert.ok(ink > 0 && edges > 0, 'opaque stems have antialiased boundaries');
	command.x += 0.25;
	assert.notDeepEqual(draw(3, 1, false), raster, 'scalable text is not snapped to the old bitmap grid');
});
