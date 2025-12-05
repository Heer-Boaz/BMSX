import type { BFont } from '../../core/font';
import type { Mesh } from '../3d/mesh';
import type { Area, Polygon, vec2, vec3arr } from '../../rompack/rompack';
import type { TextureHandle } from '../backend/pipeline_interfaces';

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

export type RenderLayer = 'world' | 'ui' | 'ide';

export type RectRenderSubmission = {
	kind: 'rect' | 'fill';
	area: Area;
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
	texture?: TextureHandle | WebGLTexture;
	ambient_mode?: 0 | 1;
	ambient_factor?: number;
	layer?: RenderLayer; // Currently unused
};

export type GlyphRenderSubmission = {
	x: number;
	y: number;
	z?: number;
	glyphs: string | string[];
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
