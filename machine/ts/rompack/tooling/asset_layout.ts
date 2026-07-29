import {
	CART_ROM_HEADER_SIZE,
	CART_ROM_WORD_ALIGNMENT,
} from '../../spec/bmsx/rom_package';
import { type RomAsset } from './assets';

export type RomAssetPayloadRange = {
	start: number;
	end: number;
	buffer: Buffer;
};

export type RomAssetPayloadLayout = {
	entries: RomAsset[];
	ranges: RomAssetPayloadRange[];
	nextOffset: number;
};

export function alignRomAssetOffset(offset: number): number {
	return (offset + CART_ROM_WORD_ALIGNMENT - 1) & ~(CART_ROM_WORD_ALIGNMENT - 1);
}

export function romAssetIsPacked(asset: RomAsset, includeLuaAssets: boolean): boolean {
	return asset.type !== 'lua' || includeLuaAssets;
}

export function layoutRomAssetPayloads(
	assetList: ReadonlyArray<RomAsset>,
	includeLuaAssets: boolean,
	initialOffset = CART_ROM_HEADER_SIZE,
): RomAssetPayloadLayout {
	const entries: RomAsset[] = [];
	const ranges: RomAssetPayloadRange[] = [];
	let offset = initialOffset;
	const appendPayload = (buffer: Buffer): RomAssetPayloadRange => {
		offset = alignRomAssetOffset(offset);
		const range = { start: offset, end: offset + buffer.length, buffer };
		offset = range.end;
		ranges.push(range);
		return range;
	};
	for (let index = 0; index < assetList.length; index += 1) {
		const source = assetList[index];
		if (!romAssetIsPacked(source, includeLuaAssets)) {
			continue;
		}
		const entry: RomAsset = {
			resid: source.resid,
			type: source.type,
		};
		if (source.id_token_lo !== undefined) entry.id_token_lo = source.id_token_lo;
		if (source.id_token_hi !== undefined) entry.id_token_hi = source.id_token_hi;
		if (source.op !== undefined) entry.op = source.op;
		if (source.source_path !== undefined) entry.source_path = source.source_path;
		if (source.normalized_source_path !== undefined) entry.normalized_source_path = source.normalized_source_path;
		if (source.update_timestamp !== undefined) entry.update_timestamp = source.update_timestamp;
		entries.push(entry);

		if (source.buffer && source.buffer.length !== 0) {
			const range = appendPayload(source.buffer);
			entry.start = range.start;
			entry.end = range.end;
		}
		if (source.compiled_buffer && source.compiled_buffer.length !== 0) {
			const range = appendPayload(source.compiled_buffer);
			entry.compiled_start = range.start;
			entry.compiled_end = range.end;
		}
		if (source.model_texture_buffer && source.model_texture_buffer.length !== 0) {
			const range = appendPayload(source.model_texture_buffer);
			entry.model_texture_start = range.start;
			entry.model_texture_end = range.end;
		}
		if (source.collision_bin_buffer && source.collision_bin_buffer.length !== 0) {
			const range = appendPayload(source.collision_bin_buffer);
			entry.collision_bin_start = range.start;
			entry.collision_bin_end = range.end;
		}
	}
	return {
		entries,
		ranges,
		nextOffset: alignRomAssetOffset(offset),
	};
}
