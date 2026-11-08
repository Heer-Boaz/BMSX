import assert from 'node:assert/strict';
import test from 'node:test';
import { streamingImage } from '../helpers/imgdec_streaming';
import { encodeDirect16GxTexture, encodePalette4GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { decodeImgDecStream, encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';

for (const palette4 of [false, true]) test(`streaming ${palette4 ? 'CLUT4' : 'direct16'} frames are distinct lossless production IMGDEC resources`, () => {
	const contents = new Set<string>();
	for (let frame = 0; frame < 8; frame += 1) {
		const rgba = streamingImage(128, 128, frame, palette4);
		for (let bit = 0; bit < 3; bit += 1) {
			const offset = bit * 4 * 4;
			assert.deepEqual([...rgba.subarray(offset, offset + 4)], [
				...Array(3).fill(((frame >> bit) & 1) * 248), 255,
			], 'the in-image frame marker is part of the generated payload');
		}
		const texture = palette4 ? encodePalette4GxTexture(128, 128, rgba) : encodeDirect16GxTexture(128, 128, rgba);
		const compressed = encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount);
		const decoded = decodeImgDecStream(compressed);
		assert.deepEqual(Buffer.from(decoded.payload), texture.words);
		assert.equal(decoded.textureWordCount, texture.textureWordCount);
		assert.equal(decoded.clutWordCount, palette4 ? 8 : 0);
		contents.add(compressed.toString('base64'));
	}
	assert.equal(contents.size, 8, 'every animation phase has a different ROM stream');
});
