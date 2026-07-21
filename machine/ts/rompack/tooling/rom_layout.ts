import { encodeBinary } from '../../common/serializer/binencoder';
import {
	alignRomAssetOffset,
	layoutRomAssetPayloads,
	romAssetIsPacked,
	type RomAssetPayloadRange,
} from '../asset_layout';
import type { AudioMeta, ImgMeta, RomAsset, RomManifest } from '../format';
import { buildRomMetadataSection } from './metadata_encode';

const EMPTY_BYTES = new Uint8Array(0);

export type RomProgramPrefixLayout = {
	romLabel: Buffer | undefined;
	entries: RomAsset[];
	assetRanges: RomAssetPayloadRange[];
	metadataAssets: RomAsset[];
	metadataHeader: Uint8Array;
	metadataPayloads: Uint8Array[];
	metadataOffset: number;
	metadataLength: number;
	manifest: Uint8Array;
	manifestOffset: number;
	programOffset: number;
};

export function layoutRomProgramPrefix(
	assetList: ReadonlyArray<RomAsset>,
	includeLuaAssets: boolean,
	manifest: RomManifest | null,
): RomProgramPrefixLayout {
	let romLabel: Buffer | undefined;
	for (let index = 0; index < assetList.length; index += 1) {
		const asset = assetList[index];
		if (asset.type === 'romlabel' && asset.buffer !== undefined && asset.buffer.length !== 0) {
			romLabel = asset.buffer;
			break;
		}
	}
	const assetLayout = layoutRomAssetPayloads(assetList, includeLuaAssets);
	const metadataAssets: RomAsset[] = [];
	const metadataValues: Array<ImgMeta | AudioMeta> = [];
	let entryIndex = 0;
	for (let index = 0; index < assetList.length; index += 1) {
		const source = assetList[index];
		if (!romAssetIsPacked(source, includeLuaAssets)) {
			continue;
		}
		const metadata = source.imgmeta !== undefined ? source.imgmeta : source.audiometa;
		if (metadata !== undefined) {
			metadataAssets.push(assetLayout.entries[entryIndex]);
			metadataValues.push(metadata);
		}
		entryIndex += 1;
	}

	let offset = assetLayout.nextOffset;
	let metadataOffset = 0;
	let metadataLength = 0;
	let metadataHeader: Uint8Array = EMPTY_BYTES;
	let metadataPayloads: Uint8Array[] = [];
	if (metadataValues.length !== 0) {
		metadataOffset = offset;
		const metadataSection = buildRomMetadataSection(metadataValues);
		metadataHeader = metadataSection.header;
		metadataPayloads = metadataSection.payloads;
		offset += metadataHeader.byteLength;
		for (let index = 0; index < metadataAssets.length; index += 1) {
			const payload = metadataPayloads[index];
			const asset = metadataAssets[index];
			asset.metabuffer_start = offset;
			offset += payload.byteLength;
			asset.metabuffer_end = offset;
		}
		metadataLength = offset - metadataOffset;
		offset = alignRomAssetOffset(offset);
	}

	let manifestOffset = 0;
	let encodedManifest: Uint8Array = EMPTY_BYTES;
	if (manifest !== null) {
		manifestOffset = offset;
		encodedManifest = encodeBinary(manifest);
		offset = alignRomAssetOffset(offset + encodedManifest.byteLength);
	}

	return {
		romLabel,
		entries: assetLayout.entries,
		assetRanges: assetLayout.ranges,
		metadataAssets,
		metadataHeader,
		metadataPayloads,
		metadataOffset,
		metadataLength,
		manifest: encodedManifest,
		manifestOffset,
		programOffset: offset,
	};
}
