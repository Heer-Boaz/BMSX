import type { BFont } from './bitmap_font';
import type { Mesh } from '../3d/mesh';
import type { RectBounds, Polygon, vec2, vec2arr, vec3arr, asset_id } from '../../rompack/rompack';

export type color = {
	r: number;
	g: number;
	b: number;
	a: number;
};

export type FlipOptions = {
	flip_h: boolean;
	flip_v: boolean;
};

export type SpriteParallaxRig = {
	vy: number;
	scale: number;
	impact: number;
	impact_t: number;
	bias_px: number;
	parallax_strength: number;
	scale_strength: number;
	flip_strength: number;
	flip_window: number;
};

export type RenderLayer = 'world' | 'ui' | 'ide';

export type OamLayer = 0 | 1 | 2;

export const OAM_LAYER_WORLD: OamLayer = 0;
export const OAM_LAYER_UI: OamLayer = 1;
export const OAM_LAYER_IDE: OamLayer = 2;
export const OAM_FLAG_ENABLED = 1;
export const OAM_ENTRY_WORD_ATLAS_ID = 0;
export const OAM_ENTRY_WORD_FLAGS = 1;
export const OAM_ENTRY_WORD_ASSET_HANDLE = 2;
export const OAM_ENTRY_WORD_LAYER = 3;
export const OAM_ENTRY_WORD_X = 4;
export const OAM_ENTRY_WORD_Y = 5;
export const OAM_ENTRY_WORD_Z = 6;
export const OAM_ENTRY_WORD_W = 7;
export const OAM_ENTRY_WORD_H = 8;
export const OAM_ENTRY_WORD_U0 = 9;
export const OAM_ENTRY_WORD_V0 = 10;
export const OAM_ENTRY_WORD_U1 = 11;
export const OAM_ENTRY_WORD_V1 = 12;
export const OAM_ENTRY_WORD_R = 13;
export const OAM_ENTRY_WORD_G = 14;
export const OAM_ENTRY_WORD_B = 15;
export const OAM_ENTRY_WORD_A = 16;
export const OAM_ENTRY_WORD_PARALLAX_WEIGHT = 17;
export const OAM_ENTRY_WORD_COUNT = 18;
export const OAM_ENTRY_BYTE_SIZE = OAM_ENTRY_WORD_COUNT * 4;

export function renderLayerToOamLayer(layer?: RenderLayer): OamLayer {
	if (layer === 'ui') return OAM_LAYER_UI;
	if (layer === 'ide') return OAM_LAYER_IDE;
	return OAM_LAYER_WORLD;
}

export function oamLayerToRenderLayer(layer: OamLayer): RenderLayer {
	if (layer === OAM_LAYER_IDE) return 'ide';
	if (layer === OAM_LAYER_UI) return 'ui';
	return 'world';
}

export type OamEntry = {
	atlasId: number;
	flags: number;
	assetHandle: number;
	x: number;
	y: number;
	z: number;
	w: number;
	h: number;
	u0: number;
	v0: number;
	u1: number;
	v1: number;
	r: number;
	g: number;
	b: number;
	a: number;
	layer: OamLayer;
	parallaxWeight: number;
};

export type OamBuffer = {
	entries: OamEntry[];
	activeCount: number;
};

export type OamFrontBackState = {
	front: OamBuffer;
	back: OamBuffer;
};

export type RectRenderSubmission = {
	kind: 'rect' | 'fill';
	area: RectBounds;
	color: color;
	layer?: RenderLayer;
};

export type ImgRenderSubmission = {
	imgid: string;
	pos: vec2;
	scale?: vec2;
	flip?: FlipOptions;
	colorize?: color;
	ambient_affected?: boolean;
	ambient_factor?: number;
	layer?: RenderLayer;
	parallax_weight?: number;
};

export type PolyRenderSubmission = {
	points: Polygon;
	z: number;
	color: color;
	thickness?: number;
	layer?: RenderLayer;
};

export type MeshRenderSubmission = {
	mesh: Mesh;
	matrix: Float32Array;
	joint_matrices?: Float32Array[];
	morph_weights?: number[];
	receive_shadow?: boolean;
	layer?: RenderLayer; // Currently unused
};

export type ParticleRenderSubmission = {
	position: vec3arr;
	size: number;
	color: color;
	texture?: asset_id;
	uv0?: vec2arr;
	uv1?: vec2arr;
	atlasBinding?: number;
	ambient_mode?: 0 | 1;
	ambient_factor?: number;
	layer?: RenderLayer; // Currently unused
};

export type GlyphRenderSubmission = {
	x: number;
	y: number;
	z?: number;
	glyphs: string | string[];
	glyph_start?: number;
	glyph_end?: number;
	font?: BFont;
	color?: color;
	background_color?: color;
	wrap_chars?: number;
	center_block_width?: number;
	align?: CanvasTextAlign;
	baseline?: CanvasTextBaseline;
	layer?: RenderLayer;
};

export type SkyboxImageIds = {
	posx: string;
	negx: string;
	posy: string;
	negy: string;
	posz: string;
	negz: string;
};
