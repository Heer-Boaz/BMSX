import type { Polygon, RectBounds } from '../../common/rect';
import type { vec2arr } from '../../common/vector';
import type {
	asset_id,
	RomTocEntry,
} from '../toc';
import type { RomImageDomain } from '../image';
import type { GLTFModel } from './gltf';
import type { CartManifest } from './manifest';

export type AudioType = 'sfx' | 'music' | 'ui';

export interface AudioMeta {
	audiotype: AudioType;
	priority: number;
	loop?: number;
	loopEnd?: number;
}

export interface BoundingBoxPrecalc {
	original: RectBounds;
	fliph?: RectBounds;
	flipv?: RectBounds;
	fliphv?: RectBounds;
}

export interface HitPolygonsPrecalc {
	original: Polygon[];
	fliph?: Polygon[];
	flipv?: Polygon[];
	fliphv?: Polygon[];
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
	gx_texture_resid?: asset_id;
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

export type RomAsset = Omit<RomTocEntry, 'id_token_lo' | 'id_token_hi'> & {
	id_token_lo?: number;
	id_token_hi?: number;
	buffer?: Buffer;
	compiled_buffer?: Buffer;
	model_texture_buffer?: Buffer;
	collision_bin_buffer?: Buffer;
	imgmeta?: ImgMeta;
	texturemeta?: TextureMeta;
	audiometa?: AudioMeta;
	payload_id?: RomImageDomain;
};

export type RomLuaAsset = RomAsset & {
	src: string;
	normalized_source_path?: string;
	update_timestamp: number;
};

export type CartridgeIndex = {
	entries: RomAsset[];
	projectRootPath: string;
	cart_manifest: CartManifest | null;
};

export type RomToolingPackage = {
	img: Record<asset_id, RomAsset>;
	audio: Record<asset_id, RomAsset>;
	model: Record<asset_id, GLTFModel>;
	data: Record<asset_id, unknown>;
	bin: Record<asset_id, RomAsset>;
	audioevents: Record<asset_id, Record<string, unknown>>;
	project_root_path: string;
	cart_manifest: CartManifest | null;
};
