import { encodeBinary } from '../../../machine/ts/common/serializer/binencoder';
import {
	alignRomAssetOffset,
	layoutRomAssetPayloads,
	romAssetIsPacked,
	type RomAssetPayloadRange,
} from './asset_layout';
import type { AudioMeta, ImgMeta, RomAsset, TextureMeta } from './assets';
import type { RomManifest } from './manifest';
import { buildRomMetadataSection } from './metadata_encode';

export type RomPrefixLayout = {
	entries: RomAsset[];
	ranges: RomAssetPayloadRange[];
	metadataOffset: number;
	metadataLength: number;
	manifestOffset: number;
	manifestLength: number;
	payloadEnd: number;
	nextOffset: number;
};

export function layoutRomPrefix(
	assetList: ReadonlyArray<RomAsset>,
	includeLuaAssets: boolean,
	manifest: RomManifest | null,
	initialOffset?: number,
): RomPrefixLayout {
	const assetLayout = layoutRomAssetPayloads(assetList, includeLuaAssets, initialOffset);
	const ranges = assetLayout.ranges;
	const metadataAssets: RomAsset[] = [];
	const metadataValues: Array<ImgMeta | TextureMeta | AudioMeta> = [];
	let entryIndex = 0;
	for (let index = 0; index < assetList.length; index += 1) {
		const source = assetList[index];
		if (!romAssetIsPacked(source, includeLuaAssets)) {
			continue;
		}
		const metadata = source.imgmeta || source.texturemeta || source.audiometa;
		if (metadata !== undefined) {
			metadataAssets.push(assetLayout.entries[entryIndex]);
			metadataValues.push(metadata);
		}
		entryIndex += 1;
	}

	let offset = assetLayout.nextOffset;
	let payloadEnd = assetLayout.payloadEnd;
	let metadataOffset = 0;
	let metadataLength = 0;
	if (metadataValues.length !== 0) {
		metadataOffset = offset;
		const metadataSection = buildRomMetadataSection(metadataValues);
		ranges.push({
			start: offset,
			end: offset + metadataSection.header.byteLength,
			buffer: metadataSection.header,
		});
		offset += metadataSection.header.byteLength;
		for (let index = 0; index < metadataAssets.length; index += 1) {
			const payload = metadataSection.payloads[index];
			const asset = metadataAssets[index];
			const payloadOffset = offset;
			asset.metabuffer_start = offset;
			offset += payload.byteLength;
			asset.metabuffer_end = offset;
			ranges.push({
				start: payloadOffset,
				end: offset,
				buffer: payload,
			});
		}
		metadataLength = offset - metadataOffset;
		payloadEnd = offset;
		offset = alignRomAssetOffset(offset);
	}

	let manifestOffset = 0;
	let manifestLength = 0;
	if (manifest !== null) {
		manifestOffset = offset;
		const encodedManifest = encodeBinary(manifest);
		manifestLength = encodedManifest.byteLength;
		ranges.push({
			start: manifestOffset,
			end: manifestOffset + manifestLength,
			buffer: encodedManifest,
		});
		payloadEnd = manifestOffset + manifestLength;
		offset = alignRomAssetOffset(payloadEnd);
	}

	return {
		entries: assetLayout.entries,
		ranges,
		metadataOffset,
		metadataLength,
		manifestOffset,
		manifestLength,
		payloadEnd,
		nextOffset: offset,
	};
}
