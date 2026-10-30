import type { Polygon, RectBounds } from '../../../machine/ts/common/rect';
import type { vec2arr } from '../../../machine/ts/common/vector';
import type {
	AssetId,
	RomTocEntry,
} from '../../../machine/ts/rompack/toc';
import type { RomImageDomain } from '../../../machine/ts/rompack/image';
import { hashAssetId } from '../../../machine/ts/rompack/tokens';
import type { GLTFModel } from './gltf';
import type { CartManifest } from '../../../machine/ts/rompack/manifest';

export type AudioType = 'sfx' | 'music' | 'ui';

/** Source filename stem to the ROM packer's logical asset id. */
export function assetIdFromSourceName(name: string): AssetId {
	return name.replace(/\s+/g, '').toLowerCase();
}

export type StructuredTextAsset = ({ readonly type: 'aem' } | { readonly type: 'data' } | { readonly type: 'collision_map' }) & {
	readonly resid: AssetId;
	readonly format: 'yaml' | 'json';
};

/** Authored structured-resource filenames, shared by packing and workspace admission. */
export function structuredTextAssetFromPath(path: string): StructuredTextAsset | undefined {
	const filename = path.slice(path.lastIndexOf('/') + 1);
	const extensionAt = filename.lastIndexOf('.');
	if (extensionAt <= 0) return;
	const extension = filename.slice(extensionAt).toLowerCase();
	let format: StructuredTextAsset['format'];
	switch (extension) {
		case '.json': format = 'json'; break;
		case '.yaml': case '.yml': format = 'yaml'; break;
		default: return;
	}
	const name = assetIdFromSourceName(filename.slice(0, extensionAt));
	if (format === 'yaml' && name.endsWith('.collision')) {
		return { type: 'collision_map', resid: name.slice(0, -'.collision'.length), format };
	}
	return { type: name.includes('.aem') ? 'aem' : 'data', resid: name.replace(/\..*$/, ''), format };
}

export interface AudioMeta {
	audiotype: AudioType;
	priority: number;
	loop?: number;
	loopEnd?: number;
}

export interface BoundingBoxPrecalc {
	original: RectBounds;
	fliph: RectBounds;
	flipv: RectBounds;
	fliphv: RectBounds;
}

export interface HitPolygonsPrecalc {
	original: Polygon[];
	fliph: Polygon[];
	flipv: Polygon[];
	fliphv: Polygon[];
}

export interface GxTexturePageTile {
	u: number;
	v: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ImgMeta {
	width: number;
	height: number;
	texture_u: number;
	texture_v: number;
	gx_atlas_id?: AssetId;
	gx_source_x?: number;
	gx_source_y?: number;
	gx_page_tiles?: GxTexturePageTile[];
	boundingbox?: BoundingBoxPrecalc;
	centerpoint?: vec2arr;
	hitpolygons?: HitPolygonsPrecalc;
}

export interface TextureMeta {
	mode: number;
	word_width: number;
	height: number;
	texture_word_count: number;
	clut_word_count: number;
}

/** Authored text retained for tooling, separate from the cooked asset payload. */
export interface SourceMeta {
	readonly text: string;
}

export type RomAsset = Omit<RomTocEntry, 'id_token_lo' | 'id_token_hi' | 'program_module'> & {
	id_token_lo?: number;
	id_token_hi?: number;
	program_module?: boolean;
	buffer?: Uint8Array;
	model_texture_buffer?: Uint8Array;
	collision_bin_buffer?: Uint8Array;
	imgmeta?: ImgMeta;
	texturemeta?: TextureMeta;
	audiometa?: AudioMeta;
	sourcemeta?: SourceMeta;
	payload_id?: RomImageDomain;
};

/** A physical TOC entry, enriched in place with tooling metadata. */
export type PackedRomAsset = RomTocEntry & RomAsset;

export type RomLuaAsset = RomAsset & {
	src: string;
	source_path: string;
	normalized_source_path: string;
	update_timestamp: number;
};

export type CartridgeIndex = {
	entries: RomAsset[];
	projectRootPath: string;
	cart_manifest: CartManifest | null;
};

export type PackedCartridgeIndex = Omit<CartridgeIndex, 'entries'> & {
	entries: PackedRomAsset[];
};

/** Complete an owned producer directory before publishing its physical TOC. */
export function finalizePackedRomAssets(entries: RomAsset[]): asserts entries is PackedRomAsset[] {
	for (const entry of entries) {
		if (entry.id_token_lo === undefined || entry.id_token_hi === undefined) {
			const token = hashAssetId(entry.resid);
			entry.id_token_lo = token.lo;
			entry.id_token_hi = token.hi;
		}
		entry.program_module ??= false;
	}
}

export type RomToolingPackage = {
	img: Record<AssetId, RomAsset>;
	audio: Record<AssetId, RomAsset>;
	model: Record<AssetId, GLTFModel>;
	data: Record<AssetId, unknown>;
	bin: Record<AssetId, RomAsset>;
	collision_shape: Record<AssetId, RomAsset>;
	audioevents: Record<AssetId, Record<string, unknown>>;
	project_root_path: string;
	cart_manifest: CartManifest | null;
};
