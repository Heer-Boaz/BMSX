import { insavegame } from 'bmsx/serializer/serializationhooks';
import type { TextureKey } from '../texturemanager';
import type { color_arr } from 'bmsx/rompack/rompack';

export interface MaterialTextures {
	albedo?: number;
	normal?: number;
	metallicRoughness?: number;
}

export interface MaterialGPUTextures {
	albedo?: TextureKey;
	normal?: TextureKey;
	metallicRoughness?: TextureKey;
}

@insavegame
export class Material {
	public textures: MaterialTextures;
	public gpuTextures: MaterialGPUTextures = {};
	public color: color_arr;
	public metallicFactor: number;
	public roughnessFactor: number;
	// Surface classification for rendering pipeline
	// opaque: write depth, no blending
	// masked: write depth, no blending, alpha test (discard) using alphaCutoff
	// transparent: depth test on, depth write off, blending enabled
	public surface: 'opaque' | 'masked' | 'transparent';
	public alphaCutoff: number;
	public doubleSided: boolean;
	constructor(opts?: { textures?: MaterialTextures; color?: color_arr; metallicFactor?: number; roughnessFactor?: number; doubleSided?: boolean }) {
		this.textures = opts?.textures ?? {};
		this.color = opts?.color ?? [1, 1, 1, 1];
		this.metallicFactor = opts?.metallicFactor ?? 1.0;
		this.roughnessFactor = opts?.roughnessFactor ?? 1.0;
		this.surface = 'masked'; // TODO: OPTIMIZE THIS!!
		this.alphaCutoff = 0.5;
		this.doubleSided = opts?.doubleSided ?? false;
	}

}
