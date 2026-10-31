import { GX_GPU_TEXTURE_MODE_DIRECT16 } from '../../../machine/ts/spec/gx/gp0';
import type { RomAsset } from './assets';
import { GX_GPU_CPU_TO_VRAM_HEADER_BYTES } from './gp0_encode';
import { decodeGxTextureImage, type GxDecodedImage } from './gx_texture_codec';
import { decodeImgDecStream } from './imgdec_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from './system_texture';

/** Decoded atlas payloads owned by a reader of one immutable ROM image. */
export type RomTextureDecodeCache = Map<string, Uint8Array>;

/** Decode an image region or an entire texture from its physical ROM asset representation. */
export function decodeRomAssetImage(
	rom: Uint8Array,
	assets: readonly RomAsset[],
	asset: RomAsset,
	cache: RomTextureDecodeCache,
	view: 'asset' | 'atlas' = 'asset',
): GxDecodedImage {
	const image = asset.type === 'image' ? asset.imgmeta : undefined;
	const region = image === undefined || view === 'atlas' ? undefined : {
		width: image.width,
		height: image.height,
		textureU: image.texture_u,
		textureV: image.texture_v,
	};
	if (image !== undefined && image.gx_atlas_id === undefined) {
		const systemTexture = assets.find(entry => entry.resid === GX_SYSTEM_TEXTURE_ASSET_ID)!;
		const uploadStart = systemTexture.start;
		const uploadSize = new DataView(rom.buffer, rom.byteOffset + uploadStart + 8, 4).getUint32(0, true);
		return decodeGxTextureImage(
			rom.subarray(uploadStart + GX_GPU_CPU_TO_VRAM_HEADER_BYTES, systemTexture.end),
			{ mode: GX_GPU_TEXTURE_MODE_DIRECT16, wordWidth: uploadSize & 0xffff, height: uploadSize >>> 16 },
			region,
		);
	}
	const texture = image === undefined ? asset : assets.find(entry => entry.resid === image.gx_atlas_id)!;
	let payload = cache.get(texture.resid);
	if (payload === undefined) {
		payload = decodeImgDecStream(rom, texture.start, texture.end - texture.start).payload;
		cache.set(texture.resid, payload);
	}
	const metadata = texture.texturemeta;
	return decodeGxTextureImage(payload, {
		mode: metadata.mode,
		wordWidth: metadata.word_width,
		height: metadata.height,
	}, region);
}
