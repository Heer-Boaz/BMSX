import { GameObject } from './gameobject';
import { insavegame } from '../serializer/gameserializer';
import type { vec3arr, OBJModel } from '../rompack/rompack';
import { bmat } from '../render/math3d';
import { TransformComponent } from '../component/transformcomponent';
import { Color, DrawMeshOptions, paintMesh } from '../render/view';
import { Material } from '../render/material';
import { ShadowMap } from '../render/shadowmap';
import { DEFAULT_VERTEX_COLOR } from '../render/glview';

export class Mesh {
    public positions: Float32Array;
    public texcoords: Float32Array;
    /** Optional normal vectors per vertex */
    public normals: Float32Array | null;
    public color: Color;
    public atlasId: number;
    public material?: Material;
    public shadow?: { map: ShadowMap; matrix: Float32Array; strength: number };

    constructor(opts?: { positions?: Float32Array; texcoords?: Float32Array; normals?: Float32Array; color?: Color; atlasId?: number; material?: Material }) {
        this.positions = opts?.positions ?? new Float32Array();
        this.texcoords = opts?.texcoords ?? new Float32Array();
        this.normals = opts?.normals ?? null;
        this.color = opts?.color ?? DEFAULT_VERTEX_COLOR;
        this.atlasId = opts?.atlasId ?? 255;
        this.material = opts?.material;
    }
}

@insavegame
export abstract class MeshObject extends GameObject {
    public mesh: Mesh;
    public rotation: vec3arr;
    public scale: vec3arr;

    constructor(id?: string, fsm_id?: string) {
        super(id, fsm_id);
        this.mesh ??= new Mesh();
        this.rotation ??= [0, 0, 0];
        this.scale ??= [1, 1, 1];
    }

    /** Apply model data to this mesh */
    public setModel(model: OBJModel): void {
        this.mesh.positions = model.positions;
        this.mesh.texcoords = model.texcoords;
        this.mesh.normals = model.normals;
    }

    override paint(): void {
        const transform = this.getComponent(TransformComponent);
        let model: Float32Array;
        if (transform) {
            model = transform.getWorldMatrix();
        } else {
            model = bmat.identity();
            model = bmat.translate(model, this.x, this.y, this.z);
            model = bmat.rotateX(model, this.rotation[0]);
            model = bmat.rotateY(model, this.rotation[1]);
            model = bmat.rotateZ(model, this.rotation[2]);
            model = bmat.scale(model, this.scale[0], this.scale[1], this.scale[2]);
        }
        const options: DrawMeshOptions = {
            positions: this.mesh.positions,
            texcoords: this.mesh.texcoords,
            normals: this.mesh.normals ?? undefined,
            matrix: model,
            color: this.mesh.color,
            atlasId: this.mesh.atlasId,
            material: this.mesh.material,
            shadow: this.mesh.shadow,
        };
        paintMesh(options);
    }
}
