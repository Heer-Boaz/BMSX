import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCanvas } from 'canvas';

import { collectRomAssetPayloadRanges } from '../../machine/ts/rompack/asset_layout';
import type { ImgMeta } from '../../machine/ts/rompack/format';
import { decodeGxTextureImage } from '../../scripts/rompacker/gx_texture';
import { resolveTextureGroupId } from '../../scripts/rompacker/atlasbuilder';
import { buildDirect16GxTexture, buildPalette4GxTexture } from '../../scripts/rompacker/gx_texture';
import { validateGxTextureLayout, type GxTextureLayout } from '../../scripts/rompacker/gx_texture_layout';
import { createTextureAtlases, generateRomAssets } from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource, TextureAtlasResource } from '../../scripts/rompacker/rompacker.rompack';
import {
	GX_CART_TEXTURE_GROUP_ID_LIMIT,
	GX_SYSTEM_TEXTURE_GROUP_ID,
} from '../../scripts/rompacker/texture_atlas_contract';

test('texture group 254 belongs exclusively to the system producer', () => {
	assert.equal(resolveTextureGroupId('/workspace/system/font.png', '/workspace/system'), GX_SYSTEM_TEXTURE_GROUP_ID);
	assert.equal(resolveTextureGroupId('/workspace/cart/player.png', '/workspace/system'), 0);
	assert.equal(GX_CART_TEXTURE_GROUP_ID_LIMIT, GX_SYSTEM_TEXTURE_GROUP_ID);
	assert.throws(
		() => resolveTextureGroupId('/workspace/cart/player@atlas=254.png', '/workspace/system', GX_SYSTEM_TEXTURE_GROUP_ID),
		/collides with reserved system texture group id/,
	);
});

test('direct16 production emits destination-free RGB555 STP words', () => {
	const texture = buildDirect16GxTexture(3, 1, new Uint8ClampedArray([
		0xff, 0x00, 0x00, 0xff,
		0xff, 0xff, 0xff, 0x00,
		0x00, 0x00, 0xff, 0xff,
	]));

	assert.equal(texture.wordWidth, 3);
	assert.equal(texture.height, 1);
	assert.deepEqual(Array.from(texture.payload), [
		0x1f, 0x80, 0x00, 0x00,
		0x00, 0xfc, 0x00, 0x00,
	]);
});

test('palette4 production keeps packed texels and the CLUT in one destination-free payload', () => {
	const texture = buildPalette4GxTexture(4, 1, new Uint8ClampedArray([
		0x00, 0x00, 0x00, 0x00,
		0xff, 0x00, 0x00, 0xff,
		0x00, 0xff, 0x00, 0xff,
		0x00, 0x00, 0xff, 0xff,
	]));

	assert.equal(texture.wordWidth, 1);
	assert.equal(texture.clutOffset, 4);
	assert.deepEqual(Array.from(texture.payload.subarray(0, 12)), [
		0x10, 0x32, 0x00, 0x00,
		0x00, 0x00, 0x1f, 0x80,
		0xe0, 0x83, 0x00, 0xfc,
	]);
});

test('ROM inspection decodes image rectangles directly from native texture payloads', () => {
	const direct = buildDirect16GxTexture(1, 1, new Uint8ClampedArray([0xff, 0x00, 0x00, 0xff]));
	const directMeta: ImgMeta = {
		width: 1,
		height: 1,
		texture_u: 0,
		texture_v: 0,
		gx_texture_mode: direct.mode,
		gx_texture_word_width: direct.wordWidth,
		gx_texture_height: direct.height,
	};
	assert.deepEqual(
		Array.from(decodeGxTextureImage(direct.payload, 0, directMeta).rgba),
		[255, 0, 0, 255],
	);

	const palette = buildPalette4GxTexture(4, 1, new Uint8ClampedArray([
		0x00, 0x00, 0x00, 0x00,
		0xff, 0x00, 0x00, 0xff,
		0x00, 0xff, 0x00, 0xff,
		0x00, 0x00, 0xff, 0xff,
	]));
	const paletteMeta: ImgMeta = {
		width: 1,
		height: 1,
		texture_u: 2,
		texture_v: 0,
		gx_texture_mode: palette.mode,
		gx_texture_word_width: palette.wordWidth,
		gx_texture_height: palette.height,
		gx_clut_offset: palette.clutOffset,
	};
	assert.deepEqual(
		Array.from(decodeGxTextureImage(palette.payload, 0, paletteMeta).rgba),
		[0, 255, 0, 255],
	);
});

test('palette4 production rejects a seventeenth RGB555 STP color', () => {
	const rgba = new Uint8ClampedArray(17 * 4);
	for (let color = 0; color < 17; color += 1) {
		const offset = color * 4;
		rgba[offset] = color << 3;
		rgba[offset + 3] = 0xff;
	}
	assert.throws(
		() => buildPalette4GxTexture(17, 1, rgba),
		/more than 16 RGB555\/STP colors/,
	);
});

test('GX layout validation rejects overlapping slots in one cart-authored working set', () => {
	const layout: GxTextureLayout = {
		reserved: {},
		slots: {
			left: { texture: { x: 0, y: 256, width: 128, height: 128 } },
			right: { texture: { x: 64, y: 256, width: 128, height: 128 } },
		},
		groups: {},
		working_sets: { scene: ['left', 'right'] },
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/working set 'scene' overlaps slots 'left' and 'right'/,
	);
});

test('GX layout validation rejects a palette4 CLUT that cannot be encoded exactly', () => {
	const layout: GxTextureLayout = {
		reserved: {},
		slots: {
			main: {
				texture: { x: 512, y: 256, width: 128, height: 128 },
				clut: { x: 513, y: 448, width: 16, height: 1 },
			},
		},
		groups: {
			0: { mode: 'palette4', slots: ['main'], page_local: true },
		},
		working_sets: {},
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/not aligned for a PSX texture page and 16-word CLUT/,
	);
});

test('GX layout validation reserves the system group id from cart manifests', () => {
	const layout: GxTextureLayout = {
		reserved: {},
		slots: {
			main: { texture: { x: 0, y: 256, width: 256, height: 256 } },
		},
		groups: {
			254: { mode: 'direct16', slots: ['main'], page_local: true },
		},
		working_sets: {},
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/not a cart texture group id below 254/,
	);
});

test('GX layout validation rejects unknown texture modes at the manifest boundary', () => {
	const layout = {
		reserved: {},
		slots: {
			main: { texture: { x: 0, y: 256, width: 256, height: 256 } },
		},
		groups: {
			0: { mode: 'rgb777', slots: ['main'], page_local: true },
		},
		working_sets: {},
	} as unknown as GxTextureLayout;
	assert.throws(
		() => validateGxTextureLayout(layout),
		/unknown mode 'rgb777'/,
	);
});

test('producer groups share one native texture span without becoming a runtime asset', async () => {
	const group: TextureAtlasResource = {
		type: 'atlas',
		name: '_atlas_00',
		id: 1,
		atlasId: 0,
	};
	const first: ImageResource = {
		type: 'image',
		name: 'first',
		id: 2,
		collisionType: 'aabb',
		targetAtlasId: 0,
		img: createCanvas(16, 16) as unknown as ImageResource['img'],
	};
	const second: ImageResource = {
		type: 'image',
		name: 'second',
		id: 3,
		collisionType: 'aabb',
		targetAtlasId: 0,
		img: createCanvas(16, 16) as unknown as ImageResource['img'],
	};
	const resources: Resource[] = [group, first, second];
	const layout: GxTextureLayout = {
		reserved: {},
		slots: {
			main: { texture: { x: 0, y: 0, width: 256, height: 256 } },
		},
		groups: {
			0: { mode: 'direct16', slots: ['main'], page_local: true },
		},
		working_sets: {
			main: ['main'],
		},
	};

	await createTextureAtlases(resources, layout);
	assert.equal(first.gxTexture, second.gxTexture);
	assert.deepEqual([first.textureU, first.textureV], [0, 0]);
	assert.deepEqual([second.textureU, second.textureV], [16, 0]);

	const assets = await generateRomAssets(resources);
	assert.deepEqual(assets.map(asset => asset.resid), ['first', 'second']);
	assert.equal(assets[0].texture_buffer, assets[1].texture_buffer);
	assert.equal(collectRomAssetPayloadRanges(assets, true).filter(range => range.kind === 'texture').length, 1);
});
