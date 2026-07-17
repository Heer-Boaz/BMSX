import { CART_ROM_HEADER_SIZE, CART_ROM_WORD_ALIGNMENT, type RomAsset } from './format';

export type RomAssetPayloadKind = 'buffer' | 'compiled' | 'texture' | 'collision_bin';

export type RomAssetPayloadRange = {
	asset: RomAsset;
	kind: RomAssetPayloadKind;
	start: number;
	end: number;
	buffer: Buffer;
	sharedAssets?: RomAsset[];
};

export function collectRomAssetPayloadRanges(assetList: ReadonlyArray<RomAsset>, includeLuaAssets: boolean): RomAssetPayloadRange[] {
	const ranges: RomAssetPayloadRange[] = [];
	const textureSharedAssets = new Map<Buffer, RomAsset[]>();
	let offset = CART_ROM_HEADER_SIZE;
	const appendPayloadRange = (asset: RomAsset, kind: RomAssetPayloadKind, buffer: Buffer, sharedAssets?: RomAsset[]) => {
		offset += (-offset) & (CART_ROM_WORD_ALIGNMENT - 1);
		const start = offset;
		offset += buffer.length;
		const range: RomAssetPayloadRange = { asset, kind, start, end: offset, buffer };
		if (sharedAssets) {
			range.sharedAssets = sharedAssets;
		}
		ranges.push(range);
	};
	for (let index = 0; index < assetList.length; index += 1) {
		const asset = assetList[index];
		if (asset.type === 'lua' && !includeLuaAssets) {
			continue;
		}
		const buffer = asset.buffer;
		if (buffer && buffer.length > 0) {
			appendPayloadRange(asset, 'buffer', buffer);
		}
		const compiledBuffer = asset.compiled_buffer;
		if (compiledBuffer && compiledBuffer.length > 0) {
			appendPayloadRange(asset, 'compiled', compiledBuffer);
		}
		const textureBuffer = asset.texture_buffer;
		if (textureBuffer && textureBuffer.length > 0) {
			const sharedAssets = textureSharedAssets.get(textureBuffer);
			if (sharedAssets) {
				sharedAssets.push(asset);
			} else {
				const newSharedAssets: RomAsset[] = [];
				textureSharedAssets.set(textureBuffer, newSharedAssets);
				appendPayloadRange(asset, 'texture', textureBuffer, newSharedAssets);
			}
		}
		const collisionBinBuffer = asset.collision_bin_buffer;
		if (collisionBinBuffer && collisionBinBuffer.length > 0) {
			appendPayloadRange(asset, 'collision_bin', collisionBinBuffer);
		}
	}
	return ranges;
}
