import type { CartRomHeader } from '../../../machine/ts/rompack/format';
import type { AssetType } from '../../../machine/ts/rompack/toc';
import type { RomAsset } from './assets';
import { BLUA32_IMAGE_ID } from './blua32_image';

export type RomAssetRangeKind = 'data' | 'metadata' | 'model-texture' | 'collision';

export type RomAssetRange = {
	kind: RomAssetRangeKind;
	start: number;
	end: number;
};

export type RomInspectionSection = {
	kind: 'header' | 'manifest' | 'toc' | 'metadata' | 'blua32' | 'asset' | 'unreferenced';
	start: number;
	end: number;
	asset?: RomAsset;
	buffer?: RomAssetRangeKind;
};

export type RomAssetTypeSummary = {
	type: AssetType;
	count: number;
	/** Logical asset attribution, including nested metadata and auxiliary buffers. */
	byteLength: number;
};

export type RomInspection = {
	byteLength: number;
	/** Disjoint physical spans. The header data range is an envelope, not another section. */
	sections: RomInspectionSection[];
	/** Logical attribution; these sizes must not be added to physical section sizes. */
	assetTypes: RomAssetTypeSummary[];
};

export function romAssetRanges(asset: RomAsset): RomAssetRange[] {
	const ranges: RomAssetRange[] = [];
	if (asset.start !== undefined) {
		ranges.push({ kind: 'data', start: asset.start, end: asset.end });
	}
	if (asset.metabuffer_start !== undefined) {
		ranges.push({ kind: 'metadata', start: asset.metabuffer_start, end: asset.metabuffer_end });
	}
	if (asset.model_texture_start !== undefined) {
		ranges.push({ kind: 'model-texture', start: asset.model_texture_start, end: asset.model_texture_end });
	}
	if (asset.collision_bin_start !== undefined) {
		ranges.push({ kind: 'collision', start: asset.collision_bin_start, end: asset.collision_bin_end });
	}
	return ranges;
}

/** All buffers belonging to an asset, without allocating range objects for table sorting. */
export function romAssetByteLength(asset: RomAsset): number {
	return (asset.start === undefined ? 0 : asset.end - asset.start)
		+ (asset.metabuffer_start === undefined ? 0 : asset.metabuffer_end - asset.metabuffer_start)
		+ (asset.model_texture_start === undefined ? 0 : asset.model_texture_end - asset.model_texture_start)
		+ (asset.collision_bin_start === undefined ? 0 : asset.collision_bin_end - asset.collision_bin_start);
}

export function romAssetIntersectsRange(asset: RomAsset, start: number, end: number): boolean {
	return (asset.start !== undefined && asset.start < end && asset.end > start)
		|| (asset.metabuffer_start !== undefined && asset.metabuffer_start < end && asset.metabuffer_end > start)
		|| (asset.model_texture_start !== undefined && asset.model_texture_start < end && asset.model_texture_end > start)
		|| (asset.collision_bin_start !== undefined && asset.collision_bin_start < end && asset.collision_bin_end > start);
}

/** Inspect one physical ROM and its own TOC, never a merged source stack or synthetic UI assets. */
export function inspectRom(rom: Uint8Array, header: CartRomHeader, assets: readonly RomAsset[]): RomInspection {
	const sections: RomInspectionSection[] = [{ kind: 'header', start: 0, end: header.headerSize }];
	if (header.manifestLength !== 0) {
		sections.push({ kind: 'manifest', start: header.manifestOffset, end: header.manifestOffset + header.manifestLength });
	}
	if (header.metadataLength !== 0) {
		sections.push({ kind: 'metadata', start: header.metadataOffset, end: header.metadataOffset + header.metadataLength });
	}
	if (header.tocLength !== 0) {
		sections.push({ kind: 'toc', start: header.tocOffset, end: header.tocOffset + header.tocLength });
	}
	if (header.blua32ImageByteCount !== 0) {
		sections.push({ kind: 'blua32', start: header.blua32ImageOffset, end: header.blua32ImageOffset + header.blua32ImageByteCount });
	}
	const assetTypes = new Map<AssetType, RomAssetTypeSummary>();
	for (const asset of assets) {
		let summary = assetTypes.get(asset.type);
		if (summary === undefined) {
			summary = { type: asset.type, count: 0, byteLength: 0 };
			assetTypes.set(asset.type, summary);
		}
		summary.count += 1;
		summary.byteLength += romAssetByteLength(asset);
		if (asset.start !== undefined && asset.resid !== BLUA32_IMAGE_ID) {
			sections.push({ kind: 'asset', buffer: 'data', start: asset.start, end: asset.end, asset });
		}
		if (asset.model_texture_start !== undefined) {
			sections.push({ kind: 'asset', buffer: 'model-texture', start: asset.model_texture_start, end: asset.model_texture_end, asset });
		}
		if (asset.collision_bin_start !== undefined) {
			sections.push({ kind: 'asset', buffer: 'collision', start: asset.collision_bin_start, end: asset.collision_bin_end, asset });
		}
	}
	sections.sort((left, right) => left.start - right.start);
	const physicalSections: RomInspectionSection[] = [];
	let end = 0;
	for (const section of sections) {
		if (end < section.start) {
			physicalSections.push({ kind: 'unreferenced', start: end, end: section.start });
		}
		physicalSections.push(section);
		end = section.end;
	}
	if (end < rom.byteLength) {
		physicalSections.push({ kind: 'unreferenced', start: end, end: rom.byteLength });
	}
	return { byteLength: rom.byteLength, sections: physicalSections, assetTypes: Array.from(assetTypes.values()) };
}
