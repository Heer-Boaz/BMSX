import type { Vec2 } from '../../common/vector';

export const TEXTURE_WRAP_CLAMP_TO_EDGE = 0x812f;
export const TEXTURE_FILTER_NEAREST = 0x2600;

export interface TextureParams {
	size: Vec2;
	wrapS: number;
	wrapT: number;
	minFilter: number;
	magFilter: number;
	srgb: boolean;
}

export const DEFAULT_TEXTURE_PARAMS: Readonly<TextureParams> = Object.freeze({
	size: Object.freeze({ x: 0, y: 0 }),
	wrapS: TEXTURE_WRAP_CLAMP_TO_EDGE,
	wrapT: TEXTURE_WRAP_CLAMP_TO_EDGE,
	minFilter: TEXTURE_FILTER_NEAREST,
	magFilter: TEXTURE_FILTER_NEAREST,
	srgb: true,
});
