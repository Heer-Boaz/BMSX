import assert from 'node:assert/strict';
import test from 'node:test';
import { HostAtlasTextures, HOST_SYSTEM_ATLAS } from '../../machine/ts/render/host_overlay/atlas';
import { HostOverlayQuadStream, HOST_OVERLAY_INSTANCE_FLOATS } from '../../machine/ts/render/host_overlay/quad_stream';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from '../../machine/ts/render/headless/host_2d';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import type { FontRendering } from '../../machine/ts/render/shared/bitmap_font';
import { createFontAtlasPair } from '../helpers/host_font_atlas';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const modes: FontRendering[] = [{ raster: 'bitmap', sampling: 'nearest' }, { raster: 'bitmap', sampling: 'linear' },
	{ raster: 'msdf', lineHeight: 3, distanceRange: 2 }];
for (const mode of modes) test(`font sources select their own pixels and UVs (${JSON.stringify(mode)})`, () => {
	const fonts = createFontAtlasPair(mode), f = createHostOverlayFixture(20, 8), stream = new HostOverlayQuadStream();
	const context = f.backend.hostOverlayContext;
	beginHeadlessHost2D(context, f.backend.framebufferPixels, 20, 8, 20, 8);
	stream.reset(20, 8);
	for (const [index, font] of fonts.entries()) {
		const command = { x: 1 + index * 6, y: 1, z: 0, items: 'A', item_start: 0, item_end: 1,
			font, color: 0xffffffff, has_background_color: false, background_color: 0, layer: LAYER_2D_IDE };
		renderHeadlessHost2DEntry(context, Host2DKind.Glyphs, command);
		stream.appendEntry(Host2DKind.Glyphs, command);
		assert.ok(stream.batches[index].atlas === font.atlas);
		const padding = mode.raster === 'bitmap' && mode.sampling === 'linear' ? 0.5 : 0;
		assert.equal(stream.floatData[index * HOST_OVERLAY_INSTANCE_FLOATS + 6], Math.fround((font.getGlyph('A').rect.u - padding) / font.atlas.width));
		for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
			assert.equal(f.backend.framebufferPixels[((y + 1) * 20 + x + command.x) * 4],
				(x === y) === (index === 0) ? 255 : 0, 'same glyph id and raster mode must not select a global atlas');
		}
	}
	assert.equal(stream.batchCount, 2);
	stream.appendEntry(Host2DKind.Clip, { left: 1, top: 1, right: 10, bottom: 5 });
	assert.ok(stream.batches[2].atlas === fonts[1].atlas, 'clip changes retain the selected resource');
	stream.reset(20, 8);
	assert.ok(stream.batches[0].atlas === HOST_SYSTEM_ATLAS, 'a new frame does not inherit the last font resource');
});

test('immutable atlas textures upload lazily, share across fonts and release with their renderer context', () => {
	const [a, b] = createFontAtlasPair(modes[2]);
	let created = 0;
	const destroyed: number[] = [];
	const textures = new HostAtlasTextures(() => ++created, texture => destroyed.push(texture));
	assert.equal(created, 0);
	assert.equal(textures.get(a.atlas), 1);
	assert.equal(textures.get(a.atlas), 1);
	assert.equal(created, 1, 'unused atlases consume no GPU storage');
	assert.equal(textures.get(b.atlas), 2);
	textures.dispose();
	assert.deepEqual(destroyed, [1, 2]);
	assert.equal(textures.get(a.atlas), 3, 'a recreated renderer cannot reuse a destroyed texture');
	textures.dispose();
	assert.deepEqual(destroyed, [1, 2, 3]);
});

test('atlas switches preserve independent bitmap bindings without redundant batches', () => {
	const stream = new HostOverlayQuadStream(), [font] = createFontAtlasPair(modes[2]);
	const bitmap = new HostBitmap({ width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) });
	const quad = { bitmap, originX: 5, originY: 5, axisXX: 1, axisXY: 0, axisYX: 0, axisYY: 1,
		u0: 0, v0: 0, u1: 1, v1: 1, color: 0xffffffff };
	const storage = stream.floatData;
	for (let frame = 0; frame < 2; frame++) {
		stream.reset(20, 8);
		stream.appendEntry(Host2DKind.Glyphs, { x: 1, y: 1, z: 0, items: 'A', item_start: 0, item_end: 1, font,
			color: 0xffffffff, has_background_color: false, background_color: 0, layer: LAYER_2D_IDE });
		stream.appendEntry(Host2DKind.Bitmap, quad);
		assert.ok(stream.batches[stream.batchCount - 1].atlas === font.atlas);
		stream.appendEntry(Host2DKind.Img, { imgid: 'whitepixel', pos: { x: 8, y: 1, z: 0 }, scale: { x: 1, y: 1 },
			flip: { flip_h: false, flip_v: false }, colorize: 0xffffffff, ambient_affected: false, ambient_factor: 1, layer: LAYER_2D_IDE });
		const batches = stream.batchCount;
		stream.appendEntry(Host2DKind.Bitmap, quad);
		assert.equal(stream.batchCount, batches, 'image/bitmap alternation needs no new batch when both bindings already match');
		assert.ok(stream.batches[batches - 1].atlas === HOST_SYSTEM_ATLAS);
		assert.ok(stream.batches[batches - 1].bitmap === bitmap);
		assert.ok(stream.floatData === storage, 'steady frames reuse vertex storage');
	}
});
