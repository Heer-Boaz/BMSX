import type { BFont } from './bitmap_font';
import type { Polygon } from '../../common/rect';
import type { Layer2D } from './layers';

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

/** Positioned bitmap text: x/y is the top-left origin, not an alignment anchor. */
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
	layer: Layer2D;
};
