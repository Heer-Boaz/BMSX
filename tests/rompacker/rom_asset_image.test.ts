import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from 'canvas';
import { createTextureAtlases, generateRomAssets } from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource, TextureAtlasResource } from '../../scripts/rompacker/rompacker.rompack';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../toolchain/ts/rompack/asset_image';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeDirect16GxUpload } from '../../toolchain/ts/rompack/gp0_encode';
import { encodeDirect16GxTexture, encodePalette4GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from '../../toolchain/ts/rompack/system_texture';

const pixels = new Uint8ClampedArray([
	255, 0, 0, 255,
	0, 255, 0, 255,
	0, 0, 255, 255,
	0, 0, 0, 0,
]);

for (const encode of [encodeDirect16GxTexture, encodePalette4GxTexture]) {
	test(`${encode.name}: selected images crop native words and share one atlas decode with the whole texture preview`, () => {
		const texture = encode(4, 1, pixels);
		const compressed = encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount);
		const rom = new Uint8Array(compressed.length + 7);
		rom.set(compressed, 3);
		const textureAsset: RomAsset = {
			resid: 'atlas', type: 'texture', start: 3, end: 3 + compressed.length,
			texturemeta: {
				mode: texture.mode, word_width: texture.wordWidth, height: texture.height,
				texture_word_count: texture.textureWordCount, clut_word_count: texture.clutWordCount,
			},
		};
		const image: RomAsset = {
			resid: 'sprite', type: 'image',
			imgmeta: { width: 2, height: 1, texture_u: 1, texture_v: 0, gx_atlas_id: 'atlas' },
		};
		const assets = [image, textureAsset];
		const cache: RomTextureDecodeCache = new Map();
		const crop = decodeRomAssetImage(rom, assets, image, cache);
		assert.deepEqual([crop.width, crop.height], [2, 1]);
		assert.deepEqual(crop.rgba, new Uint8Array(pixels.slice(4, 12)));
		const atlasPayload = cache.get('atlas');
		const atlas = decodeRomAssetImage(rom, assets, textureAsset, cache);
		assert.deepEqual([atlas.width, atlas.height], [4, 1]);
		assert.deepEqual(atlas.rgba, new Uint8Array(pixels));
		assert.deepEqual(decodeRomAssetImage(rom, assets, image, cache, 'atlas').rgba, atlas.rgba);
		assert.strictEqual(cache.get('atlas'), atlasPayload);
		// A Scene can interleave sprites from several atlases. Revisit does not decode an evicted payload again.
		const otherAtlas = { ...textureAsset, resid: 'other-atlas' };
		decodeRomAssetImage(rom, [image, textureAsset, otherAtlas], otherAtlas, cache);
		decodeRomAssetImage(rom, assets, image, cache);
		assert.equal(cache.size, 2);
		assert.strictEqual(cache.get('atlas'), atlasPayload);
		assert.deepEqual(rom.subarray(3, 3 + compressed.length), new Uint8Array(compressed));
		assert.equal(image.buffer, undefined);
		assert.equal(textureAsset.buffer, undefined);
	});
}

test('system image preview follows its raw upload packet and respects a ROM subarray byte offset', () => {
	const texture = encodeDirect16GxTexture(4, 1, pixels);
	const upload = encodeDirect16GxUpload(texture, 0, 0);
	const allocation = new Uint8Array(upload.length + 20);
	const rom = allocation.subarray(8);
	rom.set(upload, 4);
	const image: RomAsset = {
		resid: 'glyph', type: 'image',
		imgmeta: { width: 1, height: 1, texture_u: 2, texture_v: 0 },
	};
	const uploadAsset: RomAsset = { resid: GX_SYSTEM_TEXTURE_ASSET_ID, type: 'bin', start: 4, end: 4 + upload.length };
	const preview = decodeRomAssetImage(rom, [image, uploadAsset], image, new Map());
	assert.deepEqual([preview.width, preview.height], [1, 1]);
	assert.deepEqual(Array.from(preview.rgba), [0, 0, 255, 255]);
});


test('multi-page images remain contiguous in their produced atlas while drawing tiles cross hardware page boundaries', async () => {
	const canvas = createCanvas(264, 264);
	const context = canvas.getContext('2d');
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 256, 256);
	context.fillStyle = '#00ff00';
	context.fillRect(256, 0, 8, 256);
	context.fillStyle = '#0000ff';
	context.fillRect(0, 256, 256, 8);
	context.fillStyle = '#ffffff';
	context.fillRect(256, 256, 8, 8);
	const atlas: TextureAtlasResource = { type: 'atlas', name: 'surface', id: 1 };
	const source: ImageResource = {
		type: 'image', name: 'wide-tall', id: 2, collisionType: 'aabb', targetAtlasName: 'surface',
		img: canvas as unknown as ImageResource['img'],
	};
	const resources: Resource[] = [atlas, source];
	await createTextureAtlases(resources);
	const assets = await generateRomAssets(resources);
	const texture = assets.find(asset => asset.type === 'texture')!;
	const image = assets.find(asset => asset.type === 'image')!;
	texture.start = 0;
	texture.end = texture.buffer!.length;
	assert.equal(image.imgmeta!.gx_page_tiles!.length, 4);
	const preview = decodeRomAssetImage(texture.buffer!, assets, image, new Map());
	assert.deepEqual([preview.width, preview.height], [264, 264]);
	const expected = context.getImageData(0, 0, 264, 264).data;
	assert.deepEqual(preview.rgba, new Uint8Array(expected));
});
