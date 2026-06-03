import type { TextureKey } from '../texture_manager';
import type { color_arr } from '../../rompack/format';

export interface MaterialTextures {
	albedo?: number;
	normal?: number;
	metallicRoughness?: number;
	occlusion?: number;
	emissive?: number;
}

export interface MaterialTextureUVs {
	albedo?: number;
	normal?: number;
	metallicRoughness?: number;
	occlusion?: number;
	emissive?: number;
}

export interface MaterialGPUTextures {
	albedo?: TextureKey;
	normal?: TextureKey;
	metallicRoughness?: TextureKey;
	occlusion?: TextureKey;
	emissive?: TextureKey;
}

export interface MaterialOptions {
	textures?: MaterialTextures;
	textureUVs?: MaterialTextureUVs;
	color?: color_arr;
	metallicFactor?: number;
	roughnessFactor?: number;
	doubleSided?: boolean;
	occlusionStrength?: number;
	normalScale?: number;
	emissiveFactor?: color_arr;
	unlit?: boolean;
}

const EMPTY_MATERIAL_TEXTURES: MaterialTextures = {};
const EMPTY_MATERIAL_TEXTURE_UVS: MaterialTextureUVs = {};

export class Material {
	public textures: MaterialTextures;
	public gpuTextures: MaterialGPUTextures = {};
	public color: color_arr;
	public metallicFactor: number;
	public roughnessFactor: number;
	public textureUVs: MaterialTextureUVs = {};
	public occlusionStrength: number;
	public normalScale: number;
	public emissiveFactor: color_arr;
	public unlit: boolean;
	// Surface classification for rendering pipeline
	// opaque: write depth, no blending
	// masked: write depth, no blending, alpha test (discard) using alphaCutoff
	// transparent: depth test on, depth write off, blending enabled
	public surface: 'opaque' | 'masked' | 'transparent';
	public alphaCutoff: number;
	public doubleSided: boolean;
	constructor(opts: MaterialOptions = {}) {
		this.textures = opts.textures ?? EMPTY_MATERIAL_TEXTURES;
		this.textureUVs = opts.textureUVs ?? EMPTY_MATERIAL_TEXTURE_UVS;
		this.color = opts.color ?? [1, 1, 1, 1];
		this.metallicFactor = opts.metallicFactor ?? 1.0;
		this.roughnessFactor = opts.roughnessFactor ?? 1.0;
		this.occlusionStrength = opts.occlusionStrength ?? 1.0;
		this.normalScale = opts.normalScale ?? 1.0;
		this.emissiveFactor = opts.emissiveFactor ?? [0, 0, 0, 1];
		this.surface = 'opaque';
		this.alphaCutoff = 0.5;
		this.doubleSided = opts.doubleSided ?? false;
		this.unlit = !!opts.unlit;
	}

}
