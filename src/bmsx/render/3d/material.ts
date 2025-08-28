import { color_arr, insavegame } from '../..';
import type { TextureKey } from '../texturemanager';

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
    constructor(opts?: { textures?: MaterialTextures; color?: color_arr; metallicFactor?: number; roughnessFactor?: number }) {
        this.textures = opts?.textures ?? {};
        this.color = opts?.color ?? [1, 1, 1, 1];
        this.metallicFactor = opts?.metallicFactor ?? 1.0;
        this.roughnessFactor = opts?.roughnessFactor ?? 1.0;
    }

}
