import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from 'canvas';

import { BIOS_ATLAS_ID } from '../../machine/ts/rompack/format';
import { collectRomAssetPayloadRanges } from '../../machine/ts/rompack/asset_layout';
import { resolveTargetAtlasId } from '../../scripts/rompacker/atlasbuilder';
import { buildDirect16GxTextureAtlas, buildPalette4GxTextureAtlas } from '../../scripts/rompacker/gx_texture_atlas';
import { createAtlasses } from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource, TextureAtlasResource } from '../../scripts/rompacker/rompacker.rompack';
import { GX_CART_ATLAS_ID_LIMIT } from '../../scripts/rompacker/texture_atlas_contract';

test('cart atlas ids stop before the system atlas id', () => {
	assert.equal(GX_CART_ATLAS_ID_LIMIT, BIOS_ATLAS_ID);
	assert.throws(
		() => resolveTargetAtlasId('carts/example/res/player@atlas=254.png', BIOS_ATLAS_ID),
		/reserved system atlas id/,
	);
});

test('palette4 atlas production rejects a seventeenth RGB555 color', () => {
	const rgba = new Uint8ClampedArray(17 * 4);
	for (let color = 0; color < 17; color += 1) {
		const offset = color * 4;
		rgba[offset] = color << 3;
		rgba[offset + 3] = 0xff;
	}
	assert.throws(
		() => buildPalette4GxTextureAtlas(0, 17, 1, rgba),
		/more than 16 RGB555\/STP colors/,
	);
});

test('direct16 cart atlas production emits packed RGB555 STP words with odd-pixel padding', () => {
	const rgba = new Uint8ClampedArray([
		0xff, 0x00, 0x00, 0xff,
		0xff, 0xff, 0xff, 0x00,
		0x00, 0x00, 0xff, 0xff,
	]);
	const atlas = buildDirect16GxTextureAtlas(0, 3, 1, rgba);
	assert.deepEqual(Array.from(atlas.stream), [
		0x00, 0x00, 0x00, 0xa0,
		0x00, 0x00, 0x00, 0x01,
		0x03, 0x00, 0x01, 0x00,
		0x1f, 0x80, 0x00, 0x00,
		0x00, 0xfc, 0x00, 0x00,
	]);
});

test('direct16 system atlas production emits a new upload header for each 256-pixel slice', () => {
	const atlas = buildDirect16GxTextureAtlas(BIOS_ATLAS_ID, 257, 1, new Uint8ClampedArray(257 * 4));
	assert.equal(atlas.stream.byteLength, 540);
	assert.deepEqual(Array.from(atlas.stream.subarray(0, 12)), [
		0x00, 0x00, 0x00, 0xa0,
		0x00, 0x02, 0x00, 0x00,
		0x00, 0x01, 0x01, 0x00,
	]);
	assert.deepEqual(Array.from(atlas.stream.subarray(524, 536)), [
		0x00, 0x00, 0x00, 0xa0,
		0x00, 0x03, 0x00, 0x00,
		0x01, 0x00, 0x01, 0x00,
	]);
});

test('direct16 cart atlas production places overflow rows in the right-half band', () => {
	const rgba = new Uint8ClampedArray(257 * 4);
	const lastPixel = 256 * 4;
	rgba[lastPixel + 1] = 0xff;
	rgba[lastPixel + 3] = 0xff;
	const atlas = buildDirect16GxTextureAtlas(0, 1, 257, rgba);
	assert.equal(atlas.stream.byteLength, 540);
	assert.deepEqual(Array.from(atlas.stream.subarray(524)), [
		0x00, 0x00, 0x00, 0xa0,
		0x00, 0x02, 0x88, 0x00,
		0x01, 0x00, 0x01, 0x00,
		0xe0, 0x83, 0x00, 0x00,
	]);
});

test('direct16 cart atlas production rejects source geometry that aliases in VRAM', () => {
	assert.throws(
		() => buildDirect16GxTextureAtlas(0, 1025, 1, new Uint8ClampedArray(1025 * 4)),
		/does not fit the fixed cart texture region/,
	);
	assert.throws(
		() => buildDirect16GxTextureAtlas(0, 513, 377, new Uint8ClampedArray(513 * 377 * 4)),
		/does not fit the fixed cart texture region/,
	);
});

test('default atlas production keeps PNG tooling data out of the ROM payload', async () => {
	const atlas: TextureAtlasResource = { type: 'atlas', name: '_atlas_0', ext: '.atlas', id: 1, atlasId: 0 };
	const image = createCanvas(1, 1);
	image.getContext('2d').fillStyle = '#ff0000';
	image.getContext('2d').fillRect(0, 0, 1, 1);
	const resources: Resource[] = [
		atlas,
		{
			type: 'image',
			name: 'pixel',
			id: 2,
			collisionType: 'aabb',
			targetAtlasId: 0,
			img: image as unknown as ImageResource['img'],
		},
	];
	await createAtlasses(resources);
	assert.ok(atlas.buffer);
	assert.ok(atlas.gxTexture);
	assert.ok(atlas.gxTexture.stream.byteLength > 0);
	const ranges = collectRomAssetPayloadRanges([{
		resid: atlas.name,
		type: 'atlas',
		buffer: atlas.buffer,
		texture_buffer: atlas.gxTexture.stream,
	}], true);
	assert.deepEqual(ranges.map(range => range.kind), ['texture']);
});

test('split atlas allocation cannot enter the system atlas id', async () => {
	const resources: Resource[] = [
		{ type: 'atlas', name: '_atlas_253', ext: '.atlas', id: 1, atlasId: 253 },
		{
			type: 'image',
			name: 'a',
			id: 2,
			collisionType: 'aabb',
			targetAtlasId: 253,
			img: createCanvas(512, 512) as unknown as ImageResource['img'],
		},
		{
			type: 'image',
			name: 'b',
			id: 3,
			collisionType: 'aabb',
			targetAtlasId: 253,
			img: createCanvas(512, 512) as unknown as ImageResource['img'],
		},
	];

	await assert.rejects(
		() => createAtlasses(resources),
		/reserved system atlas id/,
	);
});
