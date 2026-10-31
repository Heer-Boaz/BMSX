import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';

/** Synthetic packed asset data produced by the real codecs, independent of gameplay carts. */
export function createPackedImageFixture(id: string, width: number, height: number, pixels: Uint8Array, atlasId = `${id}-atlas`) {
	const texture = encodeDirect16GxTexture(width, height, new Uint8ClampedArray(pixels));
	const bytes = new Uint8Array(encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount));
	const entries: RomAsset[] = [
		{ resid: id, type: 'image', source_path: `${id}.png`, imgmeta: { width, height, texture_u: 0, texture_v: 0, gx_atlas_id: atlasId } },
		{ resid: atlasId, type: 'texture', start: 0, end: bytes.length, texturemeta: {
			mode: texture.mode, word_width: texture.wordWidth, height: texture.height,
			texture_word_count: texture.textureWordCount, clut_word_count: texture.clutWordCount,
		} },
	];
	finalizePackedRomAssets(entries);
	return { bytes, entries, image: entries[0], pixels };
}
