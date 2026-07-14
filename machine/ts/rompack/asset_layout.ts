import { CART_ROM_HEADER_SIZE, type RomAsset } from './format';

export type RomAssetPayloadKind = 'buffer' | 'compiled' | 'texture' | 'collision_bin';

export type RomAssetPayloadRange = {
	asset: RomAsset;
	kind: RomAssetPayloadKind;
	start: number;
	end: number;
	buffer: Buffer;
	sharedAssets?: RomAsset[];
};

type SharedTexturePayloadRange = RomAssetPayloadRange & { sharedAssets: RomAsset[] };

export function collectRomAssetPayloadRanges(assetList: ReadonlyArray<RomAsset>, includeLuaAssets: boolean): RomAssetPayloadRange[] {
	const ranges: RomAssetPayloadRange[] = [];
	const textureRanges = new Map<Buffer, SharedTexturePayloadRange>();
	let offset = CART_ROM_HEADER_SIZE;
	for (let index = 0; index < assetList.length; index += 1) {
		const asset = assetList[index];
		if (asset.type === 'lua' && !includeLuaAssets) {
			continue;
		}
		const buffer = asset.buffer;
		if (buffer && buffer.length > 0) {
			const start = offset;
			offset += buffer.length;
			ranges.push({ asset, kind: 'buffer', start, end: offset, buffer });
		}
		const compiledBuffer = asset.compiled_buffer;
		if (compiledBuffer && compiledBuffer.length > 0) {
			const start = offset;
			offset += compiledBuffer.length;
			ranges.push({ asset, kind: 'compiled', start, end: offset, buffer: compiledBuffer });
		}
		const textureBuffer = asset.texture_buffer;
		if (textureBuffer && textureBuffer.length > 0) {
			const sharedRange = textureRanges.get(textureBuffer);
			if (sharedRange) {
				sharedRange.sharedAssets.push(asset);
			} else {
				const start = offset;
				offset += textureBuffer.length;
				const range: SharedTexturePayloadRange = { asset, kind: 'texture', start, end: offset, buffer: textureBuffer, sharedAssets: [] };
				textureRanges.set(textureBuffer, range);
				ranges.push(range);
			}
		}
		const collisionBinBuffer = asset.collision_bin_buffer;
		if (collisionBinBuffer && collisionBinBuffer.length > 0) {
			const start = offset;
			offset += collisionBinBuffer.length;
			ranges.push({ asset, kind: 'collision_bin', start, end: offset, buffer: collisionBinBuffer });
		}
	}
	return ranges;
}
