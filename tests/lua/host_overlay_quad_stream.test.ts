import assert from 'node:assert/strict';
import test from 'node:test';
import {
	HOST_OVERLAY_INSTANCE_FLOATS,
	HOST_OVERLAY_TEXTURE_ATLAS,
	HOST_OVERLAY_TEXTURE_SOLID,
	HostOverlayQuadStream,
} from '../../machine/ts/render/host_overlay/quad_stream';
import { HOST_SYSTEM_ATLAS_HEIGHT, HOST_SYSTEM_ATLAS_WIDTH } from '../../machine/ts/rompack/host_system_atlas';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import {
	RectRenderKind,
	TextAlign,
	TextBaseline,
	type Host2DKind,
	type Host2DRef,
	type Host2DSubmission,
} from '../../machine/ts/render/shared/submissions';
import {
	clearHostMenuFrame,
	consumeHostMenuFrame,
	hasPendingHostMenuFrame,
	publishHostMenuFrame,
} from '../../machine/ts/render/host_overlay/overlay_queue';

test('host overlay quad stream retains ordered solid and atlas instances', () => {
	const stream = new HostOverlayQuadStream();
	const commands: Host2DSubmission[] = [
		{
			type: 'rect',
			kind: RectRenderKind.Fill,
			area: { left: 12, top: 8, right: 4, bottom: 2, z: 0 },
			color: 0x80402010,
			layer: LAYER_2D_IDE,
		},
		{
			type: 'img',
			imgid: 'copy',
			pos: { x: 20, y: 30, z: 0 },
			scale: { x: 2, y: 3 },
			flip: { flip_h: true, flip_v: false },
			colorize: 0xffffffff,
			ambient_affected: false,
			ambient_factor: 1,
			layer: LAYER_2D_IDE,
		},
	];
	for (let index = 0; index < commands.length; index += 1) {
		stream.appendSubmission(commands[index]);
	}

	assert.equal(stream.count, 2);
	assert.equal(stream.textureKinds[0], HOST_OVERLAY_TEXTURE_SOLID);
	assert.equal(stream.textureKinds[1], HOST_OVERLAY_TEXTURE_ATLAS);
	assert.deepEqual(Array.from(stream.floatData.subarray(0, 6)), [4, 2, 8, 0, 0, 6]);
	const imageBase = HOST_OVERLAY_INSTANCE_FLOATS;
	assert.deepEqual(Array.from(stream.floatData.subarray(imageBase, imageBase + 6)), [20, 30, 12, 0, 0, 24]);
	assert.ok(stream.floatData[imageBase + 6] > stream.floatData[imageBase + 8]);

	const retainedFloats = stream.floatData;
	const retainedKinds = stream.textureKinds;
	stream.reset();
	stream.appendSubmission(commands[0]);
	assert.equal(stream.floatData, retainedFloats);
	assert.equal(stream.textureKinds, retainedKinds);
	assert.equal(stream.count, 1);
});

test('host overlay quad stream emits glyph backgrounds before atlas glyphs with atlas UVs', () => {
	const stream = new HostOverlayQuadStream();
	const font = new Font();
	stream.appendSubmission({
		type: 'items',
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
		wrap_chars: 0,
		center_block_width: 0,
		align: TextAlign.Start,
		baseline: TextBaseline.Alphabetic,
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
		Math.fround(firstGlyph.rect.u / HOST_SYSTEM_ATLAS_WIDTH),
		Math.fround(firstGlyph.rect.v / HOST_SYSTEM_ATLAS_HEIGHT),
		Math.fround((firstGlyph.rect.u + firstGlyph.rect.w) / HOST_SYSTEM_ATLAS_WIDTH),
		Math.fround((firstGlyph.rect.v + firstGlyph.rect.h) / HOST_SYSTEM_ATLAS_HEIGHT),
	]);
	assert.equal(stream.floatData[secondGlyphBase], 10 + firstGlyph.advance);
	assert.equal(stream.floatData[secondGlyphBase + 2], secondGlyph.width);
});

test('host menu queue retains producer arrays across the global publication boundary', () => {
	const command = {
		kind: RectRenderKind.Fill,
		area: { left: 0, top: 0, right: 1, bottom: 1, z: 0 },
		color: 0xffffffff,
		layer: LAYER_2D_IDE,
	};
	const commandKinds: Host2DKind[] = ['rect'];
	const commandRefs: Host2DRef[] = [command];
	const frame = { commandKinds, commandRefs, commandCount: 1 };
	publishHostMenuFrame(frame);
	assert.equal(hasPendingHostMenuFrame(), true);
	const consumed = consumeHostMenuFrame();
	assert.equal(consumed, frame);
	assert.equal(consumed.commandKinds, commandKinds);
	assert.equal(consumed.commandRefs, commandRefs);
	assert.equal(hasPendingHostMenuFrame(), false);
	publishHostMenuFrame(frame);
	clearHostMenuFrame();
	assert.equal(hasPendingHostMenuFrame(), false);
});
