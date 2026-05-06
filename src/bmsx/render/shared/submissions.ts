import type { BFont } from './bitmap_font';
import type { Mesh } from '../3d/mesh';
import type { RectBounds, Polygon, vec2, vec2arr, vec3arr } from '../../rompack/format';
import type { color } from '../../common/color';
import {
	LAYER_2D_IDE,
	LAYER_2D_UI,
	LAYER_2D_WORLD,
	type Layer2D,
} from '../../machine/devices/vdp/contracts';

export type { color } from '../../common/color';

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

export type RectRenderSubmission = {
	kind: 'rect' | 'fill';
	area: RectBounds;
	color: color;
	layer: RenderLayer;
};

type ImageRenderSubmissionBase = {
	pos: vec2;
	scale: vec2;
	flip: FlipOptions;
	colorize: color;
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
	color: color;
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
	color: color;
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
	font: BFont;
	color: color;
	background_color: color | null;
	wrap_chars: number;
	center_block_width: number;
	align: CanvasTextAlign;
	baseline: CanvasTextBaseline;
	layer: RenderLayer;
};
