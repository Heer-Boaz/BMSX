import type { TextureKey } from '../texturemanager';
import { color_arr } from '../view';

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

export class Material {
    public textures: MaterialTextures;
    public gpuTextures: MaterialGPUTextures = {};
    public color: color_arr;
    constructor(opts?: { textures?: MaterialTextures; color?: color_arr }) {
        this.textures = opts?.textures ?? {};
        this.color = opts?.color ?? [1, 1, 1, 1];
    }
}
