import type { BFont } from './bitmap_font';
import type { Mesh } from '../3d/mesh';
import type { Polygon, vec2arr, vec3arr } from '../../rompack/format';
import type { Layer2D } from '../../machine/devices/vdp/contracts';

export type color = number;

export type FlipOptions = {
	flip_h: boolean;
	flip_v: boolean;
};

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

export const enum TextAlign { Left, Right, Center, Start, End }
export const enum TextBaseline { Top, Hanging, Middle, Alphabetic, Ideographic, Bottom }
export const enum RectRenderKind { Rect, Fill }

export type RectRenderSubmission = {
	kind: RectRenderKind;
	area: RenderRectBounds;
	color: color;
	layer: Layer2D;
};

type ImageRenderSubmissionBase = {
	pos: RenderVec2;
	scale: RenderScale2;
	flip: FlipOptions;
	colorize: color;
	ambient_affected: boolean;
	ambient_factor: number;
	layer: Layer2D;
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
	layer: Layer2D;
};

export type MeshRenderSubmission = {
	mesh: Mesh;
	matrix: Float32Array;
	joint_matrices: Float32Array[];
	morph_weights: number[];
	receive_shadow: boolean;
	layer: Layer2D;
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
	layer: Layer2D;
};

export type GlyphRenderSubmission = {
	x: number;
	y: number;
	z: number;
	glyphs: string | string[];
	glyph_start: number;
	glyph_end: number;
	font: BFont | null;
	color: color;
	has_background_color: boolean;
	background_color: color;
	wrap_chars: number;
	center_block_width: number;
	align: TextAlign;
	baseline: TextBaseline;
	layer: Layer2D;
};
