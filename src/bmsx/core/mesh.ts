import { TransformComponent } from '../component/transformcomponent';
import { Material } from '../render/3d/material';
import { bmat } from '../render/3d/math3d';
import { ShadowMap } from '../render/3d/shadowmap';
import { DEFAULT_VERTEX_COLOR } from '../render/glview.constants';
import { Color, DrawMeshOptions } from '../render/view';
import type { asset_id, GLTFMesh, GLTFModel, vec3arr } from '../rompack/rompack';
import { insavegame, onload } from '../serializer/gameserializer';
import { GameObject } from './gameobject';

export class Mesh {
    public positions: Float32Array;
    public texcoords: Float32Array;
    /** Optional normal vectors per vertex */
    public normals: Float32Array | null;
    /** Optional index buffer */
    public indices?: Uint16Array | Uint32Array;
    public color: Color;
    public atlasId: number;
    public material?: Material;
    public shadow?: { map: ShadowMap; matrix: Float32Array; strength: number };

    constructor(opts?: { positions?: Float32Array; texcoords?: Float32Array; normals?: Float32Array; indices?: Uint16Array | Uint32Array; color?: Color; atlasId?: number; material?: Material }) {
        this.positions = opts?.positions ?? new Float32Array();
        this.texcoords = opts?.texcoords ?? new Float32Array();
        this.normals = opts?.normals ?? null;
        this.indices = opts?.indices;
        this.color = opts?.color ?? DEFAULT_VERTEX_COLOR;
        this.atlasId = opts?.atlasId ?? 255;
        this.material = opts?.material;
    }
}

@insavegame
export abstract class MeshObject extends GameObject {
    public mesh: Mesh;
    public meshModel: GLTFModel;
    public rotation: vec3arr;
    public scale: vec3arr;
    private _model_id?: asset_id;

    constructor(id?: string, fsm_id?: string) {
        super(id, fsm_id);
        this.rotation ??= [0, 0, 0];
        this.scale ??= [1, 1, 1];
    }

    public get model_id(): asset_id | undefined {
        return this._model_id;
    }

    public set model_id(model_id: asset_id) {
        if (this._model_id === model_id) return; // No change, do nothing
        if (this._model_id) this.releaseModel(this.meshModel); // Release previous model textures
        this._model_id = model_id; // Set new model ID
        this.setMeshModel($.rompack.model[this.model_id]); // Load the new model
    }

    public setMesh(mesh: GLTFMesh): void {
        if (!this.mesh) {
            this.mesh = new Mesh({
                positions: mesh.positions.slice(),
                texcoords: mesh.texcoords?.slice() ?? new Float32Array(),
                normals: mesh.normals?.slice() ?? null,
                indices: mesh.indices?.slice() ?? undefined,
                atlasId: mesh.materialIndex !== undefined ? 255 : 0,
            });
        }
        else {
            this.mesh.positions = mesh.positions.slice();
            this.mesh.texcoords = mesh.texcoords?.slice() ?? new Float32Array();
            this.mesh.normals = mesh.normals?.slice() ?? null;
            this.mesh.indices = mesh.indices?.slice() ?? undefined;
            this.mesh.atlasId = mesh.materialIndex !== undefined ? 255 : 0;
        }
        const meshModel = this.meshModel;
        const mat = meshModel.materials[meshModel.meshes[0].materialIndex];
        let albedo = mat.baseColorTexture;
        let normal = mat.normalTexture;
        let metallicRoughness = mat.metallicRoughnessTexture;
        if (meshModel.textures) {
            if (albedo !== undefined) albedo = meshModel.textures[albedo] ?? albedo;
            if (normal !== undefined) normal = meshModel.textures[normal] ?? normal;
            if (metallicRoughness !== undefined) metallicRoughness = meshModel.textures[metallicRoughness] ?? metallicRoughness;
        }
        if (!this.mesh.material) {
            this.mesh.material = new Material({
                color: mat.baseColorFactor ? [...mat.baseColorFactor] : [1, 1, 1, 1],
                textures: {
                    albedo: albedo !== undefined ? albedo : undefined,
                    normal: normal !== undefined ? normal : undefined,
                    metallicRoughness: metallicRoughness !== undefined ? metallicRoughness : undefined,
                },
                metallicFactor: mat.metallicFactor ?? 1.0,
                roughnessFactor: mat.roughnessFactor ?? 1.0,
            });
        }
        else {
            this.mesh.material.color = mat.baseColorFactor ? [...mat.baseColorFactor] : [1, 1, 1, 1];
            this.mesh.material.textures.albedo = albedo !== undefined ? albedo : undefined;
            this.mesh.material.textures.normal = normal !== undefined ? normal : undefined;
            this.mesh.material.textures.metallicRoughness = metallicRoughness !== undefined ? metallicRoughness : undefined;
            this.mesh.material.metallicFactor = mat.metallicFactor ?? 1.0;
            this.mesh.material.roughnessFactor = mat.roughnessFactor ?? 1.0;
        }

        this.loadMeshModel(this.meshModel);
    }

    public setMeshModel(meshModel: GLTFModel): void {
        if (!this.meshModel) {
            this.meshModel = $.rompack.model[this.model_id];
        }

        this.setMesh(meshModel.meshes[0]);

        this.loadMeshModel(this.meshModel);
    }

    @onload
    public onLoad(_meshobject: MeshObject): void {
        if (this.meshModel) {
            this.loadMeshModel(this.meshModel);
        }
        else if (this._model_id) {
            this.loadMeshModel(this.meshModel);
        }
    }

    private loadMeshModel(meshModel: GLTFModel): void {
        $.texmanager.fetchModelTextures(meshModel).then((gpuTextureKeys) => {
            if (!this.mesh.material) return;
            const tex = this.mesh.material.textures;
            if (tex.albedo !== undefined) {
                this.mesh.material.gpuTextures.albedo = gpuTextureKeys[tex.albedo];
            }
            if (tex.normal !== undefined) {
                this.mesh.material.gpuTextures.normal = gpuTextureKeys[tex.normal];
            }
            if (tex.metallicRoughness !== undefined) {
                this.mesh.material.gpuTextures.metallicRoughness = gpuTextureKeys[tex.metallicRoughness];
            }
        });
    }

    public releaseModel(model: GLTFModel): void {
        $.texmanager.releaseModelTextures(model);
    }

    override dispose(): void {
        if (this._model_id) {
            this.releaseModel($.rompack.model[this._model_id]);
            this._model_id = undefined;
        }
        super.dispose();
    }

    override paint(): void {
        if (!this.mesh || !this.mesh.positions || this.mesh.positions.length === 0) return; // No mesh to draw
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
            indices: this.mesh.indices,
            matrix: model,
            color: this.mesh.color,
            atlasId: this.mesh.atlasId,
            material: this.mesh.material,
            shadow: this.mesh.shadow,
        };
        $.view.drawMesh(options);
    }
}
