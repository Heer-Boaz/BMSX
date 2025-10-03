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

export type RenderLayer = 'background' | 'world' | 'ui' | 'overlay';

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
	ambientAffected?: boolean;
	ambientFactor?: number;
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
	jointMatrices?: Float32Array[];
	morphWeights?: number[];
	receiveShadow?: boolean;
};

export type ParticleRenderSubmission = {
	position: vec3arr;
	size: number;
	color: color;
	texture?: TextureHandle | WebGLTexture | null;
	ambientMode?: 0 | 1;
	ambientFactor?: number;
};

export type GlyphRenderSubmission = {
	x: number;
	y: number;
	z?: number;
	glyphs: string | string[];
	font?: BFont;
	color?: color;
	backgroundColor?: color;
	wrapChars?: number;
	centerBlockWidth?: number;
	align?: CanvasTextAlign;
	baseline?: CanvasTextBaseline;
	layer?: RenderLayer;
};

export type SkyboxImageIds = {
	posX: string;
	negX: string;
	posY: string;
	negY: string;
	posZ: string;
	negZ: string;
};

