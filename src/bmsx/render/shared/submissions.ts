import type { BFont } from './bitmap_font';
import type { Polygon } from '../../rompack/format';
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

export type Host2DKind = 'img' | 'poly' | 'rect' | 'items';
export type Host2DRef = HostImageRenderSubmission | PolyRenderSubmission | RectRenderSubmission | GlyphRenderSubmission;
export type Host2DSubmission =
	| ({ type: 'img' } & HostImageRenderSubmission)
	| ({ type: 'poly' } & PolyRenderSubmission)
	| ({ type: 'rect' } & RectRenderSubmission)
	| ({ type: 'items' } & GlyphRenderSubmission);

export type PolyRenderSubmission = {
	points: Polygon;
	z: number;
	color: color;
	thickness: number;
	layer: Layer2D;
};

export type GlyphRenderSubmission = {
	x: number;
	y: number;
	z: number;
	items: string | string[];
	item_start: number;
	item_end: number;
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
