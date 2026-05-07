import type { BFont } from './bitmap_font';
import type { Mesh } from '../3d/mesh';
import type { Polygon, vec2arr, vec3arr } from '../../rompack/format';
import {
	LAYER_2D_IDE,
	LAYER_2D_UI,
	LAYER_2D_WORLD,
	type Layer2D,
} from '../../machine/devices/vdp/contracts';

export type color = number;

export type FlipOptions = {
	flip_h: boolean;
	flip_v: boolean;
};

export type RenderLayer = 'world' | 'ui' | 'ide';

export function renderLayerTo2dLayer(layer: RenderLayer): Layer2D {
	if (layer === 'ui') return LAYER_2D_UI;
	if (layer === 'ide') return LAYER_2D_IDE;
	return LAYER_2D_WORLD;
}

export type RenderRectBounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	z: number;
};

export type RenderVec2 = {
	x: number;
	y: number;
	z: number;
};

export type RenderScale2 = {
	x: number;
	y: number;
};

export type TextAlign = CanvasTextAlign;
export type TextBaseline = CanvasTextBaseline;

export type TextureParams = {
	size?: RenderScale2;
	wrapS?: number;
	wrapT?: number;
	minFilter?: number;
	magFilter?: number;
	srgb?: boolean;
};

export type RectRenderSubmission = {
	kind: 'rect' | 'fill';
	area: RenderRectBounds;
	color: color | null;
	layer: RenderLayer;
};

type ImageRenderSubmissionBase = {
	pos: RenderVec2;
	scale: RenderScale2;
	flip: FlipOptions;
	colorize: color | null;
	ambient_affected: boolean;
	ambient_factor: number;
	layer: RenderLayer;
	parallax_weight: number;
};

export type ImgRenderSubmission = ImageRenderSubmissionBase & {
	slot: number;
	u: number;
	v: number;
	w: number;
	h: number;
};

export type HostImageRenderSubmission = ImageRenderSubmissionBase & {
	imgid: string;
};

export type PolyRenderSubmission = {
	points: Polygon;
	z: number;
	color: color | null;
	thickness: number;
	layer: RenderLayer;
};

export type MeshRenderSubmission = {
	mesh: Mesh;
	matrix: Float32Array;
	joint_matrices: Float32Array[];
	morph_weights: number[];
	receive_shadow: boolean;
	layer: RenderLayer;
};

export type ParticleRenderSubmission = {
	position: vec3arr;
	size: number;
	color: color | null;
	slot: number;
	u: number;
	v: number;
	w: number;
	h: number;
	uv0: vec2arr;
	uv1: vec2arr;
	ambient_mode: 0 | 1;
	ambient_factor: number;
	layer: RenderLayer;
};

export type GlyphRenderSubmission = {
	x: number;
	y: number;
	z: number;
	glyphs: string | string[];
	glyph_start: number;
	glyph_end: number;
	font: BFont | null;
	color: color | null;
	background_color: color | null;
	wrap_chars: number;
	center_block_width: number;
	align: TextAlign;
	baseline: TextBaseline;
	layer: RenderLayer;
};
