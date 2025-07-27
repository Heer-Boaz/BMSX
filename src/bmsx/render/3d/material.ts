export interface MaterialTextures {
    albedo?: string;
    normal?: string;
    metallicRoughness?: string;
}

export class Material {
    public textures: MaterialTextures;
    public color: [number, number, number];
    constructor(opts?: { textures?: MaterialTextures; color?: [number, number, number] }) {
        this.textures = opts?.textures ?? {};
        this.color = opts?.color ?? [1, 1, 1];
    }
}
