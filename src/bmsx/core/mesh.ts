import { TransformComponent } from '../component/transformcomponent';
import { Material } from '../render/3d/material';
import { bmat } from '../render/3d/math3d';
import { ShadowMap } from '../render/3d/shadowmap';
import { DEFAULT_VERTEX_COLOR } from '../render/glview.constants';
import type { Color, DrawMeshOptions } from '../render/view';
import type { TextureKey } from '../render/texturemanager';
import type { asset_id, GLTFMesh, GLTFModel, GLTFNode, GLTFAnimationSampler, vec3arr } from '../rompack/rompack';
import { insavegame, onload } from '../serializer/gameserializer';
import { GameObject } from './gameobject';

export class Mesh {
    public positions: Float32Array;
    public texcoords: Float32Array;
    /** Optional normal vectors per vertex */
    public normals: Float32Array | null;
    /** Optional tangent vectors per vertex (xyz + w sign) */
    public tangents: Float32Array | null;
    /** Optional index buffer */
    public indices?: Uint16Array | Uint32Array;
    public color: Color;
    public atlasId: number;
    public material?: Material;
    public shadow?: { map: ShadowMap; matrix: Float32Array; strength: number };
    public morphPositions?: Float32Array[];
    public morphNormals?: Float32Array[];
    public morphTangents?: Float32Array[];
    public morphWeights: number[];
    public jointIndices?: Uint16Array;
    public jointWeights?: Float32Array;

    constructor(opts?: { positions?: Float32Array; texcoords?: Float32Array; normals?: Float32Array; tangents?: Float32Array; indices?: Uint16Array | Uint32Array; color?: Color; atlasId?: number; material?: Material; morphPositions?: Float32Array[]; morphNormals?: Float32Array[]; morphTangents?: Float32Array[]; morphWeights?: number[]; jointIndices?: Uint16Array; jointWeights?: Float32Array }) {
        this.positions = opts?.positions ?? new Float32Array();
        this.texcoords = opts?.texcoords ?? new Float32Array();
        this.normals = opts?.normals ?? null;
        this.tangents = opts?.tangents ?? null;
        this.indices = opts?.indices;
        this.color = opts?.color ?? DEFAULT_VERTEX_COLOR;
        this.atlasId = opts?.atlasId ?? 255;
        this.material = opts?.material;
        this.morphPositions = opts?.morphPositions;
        this.morphNormals = opts?.morphNormals;
        this.morphTangents = opts?.morphTangents;
        this.morphWeights = opts?.morphWeights ?? [];
        this.jointIndices = opts?.jointIndices;
        this.jointWeights = opts?.jointWeights;
    }

    public get vertexCount(): number {
        return this.positions.length / 3;
    }

    public get hasTexcoords(): boolean {
        return this.texcoords.length >= this.vertexCount * 2;
    }

    public get hasNormals(): boolean {
        return !!(this.normals && this.normals.length >= this.vertexCount * 3);
    }

    public get hasTangents(): boolean {
        return !!this.tangents;
    }

    public get hasSkinning(): boolean {
        return !!(this.jointIndices && this.jointWeights);
    }

    public get gpuTextureAlbedo(): TextureKey | undefined {
        return this.material?.gpuTextures.albedo;
    }

    public get gpuTextureNormal(): TextureKey | undefined {
        return this.material?.gpuTextures.normal;
    }

    public get gpuTextureMetallicRoughness(): TextureKey | undefined {
        return this.material?.gpuTextures.metallicRoughness;
    }
}

interface MeshInstance {
    mesh: Mesh;
    matrix: Float32Array;
    skinIndex?: number;
}

@insavegame
export abstract class MeshObject extends GameObject {
    public meshes: Mesh[] = [];
    public meshModel: GLTFModel;
    public rotation: vec3arr;
    public scale: vec3arr;
    private _model_id?: asset_id;
    private meshInstances: MeshInstance[] = [];
    private nodeDirty: boolean[] = [];
    private worldMatrices: Float32Array[] = [];
    private animationTime = 0;

    constructor(id?: string, fsm_id?: string) {
        super(id, fsm_id);
        this.rotation ??= [0, 0, 0];
        this.scale ??= [1, 1, 1];
    }

    /** Convenience getter returning the first mesh */
    public get mesh(): Mesh | undefined {
        return this.meshes[0];
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

    private createMesh(mesh: GLTFMesh, meshModel: GLTFModel): Mesh {
        const m = new Mesh({
            positions: mesh.positions.slice(),
            texcoords: mesh.texcoords?.slice() ?? new Float32Array(),
            normals: mesh.normals?.slice() ?? null,
            tangents: mesh.tangents?.slice() ?? null,
            indices: mesh.indices?.slice() ?? undefined,
            atlasId: mesh.materialIndex !== undefined ? 255 : 0,
            morphPositions: mesh.morphPositions?.map(t => t.slice()),
            morphNormals: mesh.morphNormals?.map(t => t.slice()),
            morphTangents: mesh.morphTangents?.map(t => t.slice()),
            morphWeights: mesh.weights ? [...mesh.weights] : [],
            jointIndices: mesh.jointIndices?.slice(),
            jointWeights: mesh.jointWeights?.slice(),
        });

        const mat = meshModel.materials?.[mesh.materialIndex ?? 0];
        let albedo = mat?.baseColorTexture;
        let normal = mat?.normalTexture;
        let metallicRoughness = mat?.metallicRoughnessTexture;
        if (meshModel.textures) {
            if (albedo !== undefined) albedo = meshModel.textures[albedo] ?? albedo;
            if (normal !== undefined) normal = meshModel.textures[normal] ?? normal;
            if (metallicRoughness !== undefined) metallicRoughness = meshModel.textures[metallicRoughness] ?? metallicRoughness;
        }

        m.material = new Material({
            color: mat?.baseColorFactor ? [...mat.baseColorFactor] as any : [1, 1, 1, 1],
            textures: {
                albedo: albedo !== undefined ? albedo : undefined,
                normal: normal !== undefined ? normal : undefined,
                metallicRoughness: metallicRoughness !== undefined ? metallicRoughness : undefined,
            },
            metallicFactor: mat?.metallicFactor ?? 1.0,
            roughnessFactor: mat?.roughnessFactor ?? 1.0,
        });

        return m;
    }

    public setMeshModel(meshModel: GLTFModel): void {
        this.meshModel = meshModel;
        this.meshes = meshModel.meshes.map(m => this.createMesh(m, meshModel));
        if (meshModel.nodes) {
            this.worldMatrices = meshModel.nodes.map(() => bmat.identity());
            this.nodeDirty = meshModel.nodes.map(() => true);
        } else {
            this.worldMatrices = [];
            this.nodeDirty = [];
        }
        this.recalcMeshInstances();
        this.loadMeshModel(this.meshModel);
    }

    public override run(): void {
        if (this.meshModel?.animations) {
            this.animationTime += $.deltaTime / 1000;
            let nodesChanged = false;
            for (const anim of this.meshModel.animations) {
                for (const channel of anim.channels) {
                    const sampler = anim.samplers[channel.sampler];
                    const stride = sampler.output.length / sampler.input.length;
                    const comp = sampler.interpolation === 'CUBICSPLINE' ? stride / 3 : stride;
                    const value = this.sampleAnimation(sampler, this.animationTime, comp);
                    if (channel.target.node !== undefined && this.meshModel.nodes) {
                        const node = this.meshModel.nodes[channel.target.node];
                        switch (channel.target.path) {
                            case 'rotation':
                                node.rotation = [value[0], value[1], value[2], value[3]];
                                node.matrix = undefined;
                                this.markNodeDirty(channel.target.node);
                                nodesChanged = true;
                                break;
                            case 'translation':
                                node.translation = [value[0], value[1], value[2]];
                                node.matrix = undefined;
                                this.markNodeDirty(channel.target.node);
                                nodesChanged = true;
                                break;
                            case 'scale':
                                node.scale = [value[0], value[1], value[2]];
                                node.matrix = undefined;
                                this.markNodeDirty(channel.target.node);
                                nodesChanged = true;
                                break;
                            case 'weights':
                                if (node.mesh !== undefined) {
                                    const mesh = this.meshes[node.mesh];
                                    mesh.morphWeights = Array.from(value);
                                }
                                break;
                        }
                    }
                }
            }
            if (nodesChanged) this.recalcMeshInstances();
        }
        super.run();
    }

    private sampleAnimation(s: GLTFAnimationSampler, time: number, stride: number): Float32Array {
        const input = s.input;
        const output = s.output;
        const last = input.length - 1;
        const t = time % input[last];
        let i = 0;
        while (i < last && t >= input[i + 1]) i++;
        const j = Math.min(i + 1, last);
        const t0 = input[i];
        const t1 = input[j];
        const dt = t1 - t0;
        const res = new Float32Array(stride);
        switch (s.interpolation) {
            case 'STEP': {
                const start = i * stride;
                for (let k = 0; k < stride; k++) res[k] = output[start + k];
                break;
            }
            case 'CUBICSPLINE': {
                const start = i * stride * 3;
                const end = j * stride * 3;
                const u = dt === 0 ? 0 : (t - t0) / dt;
                const u2 = u * u; const u3 = u2 * u;
                const s0 = 2.0 * u3 - 3.0 * u2 + 1.0;
                const s1 = u3 - 2.0 * u2 + u;
                const s2 = -2.0 * u3 + 3.0 * u2;
                const s3 = u3 - u2;
                for (let k = 0; k < stride; k++) {
                    const p0 = output[start + stride + k];
                    const m0 = output[start + stride * 2 + k];
                    const p1 = output[end + stride + k];
                    const m1 = output[end + k];
                    res[k] = s0 * p0 + s1 * m0 * dt + s2 * p1 + s3 * m1 * dt;
                }
                break;
            }
            default: {
                const alpha = dt > 0 ? (t - t0) / dt : 0;
                const start = i * stride;
                const end = j * stride;
                for (let k = 0; k < stride; k++) {
                    const v0 = output[start + k];
                    const v1 = output[end + k];
                    res[k] = v0 + (v1 - v0) * alpha;
                }
                break;
            }
        }
        return res;
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
            meshModel.gpuTextures = gpuTextureKeys;
            for (const mesh of this.meshes) {
                if (!mesh.material) continue;
                const tex = mesh.material.textures;
                if (tex.albedo !== undefined) {
                    mesh.material.gpuTextures.albedo = gpuTextureKeys[tex.albedo];
                }
                if (tex.normal !== undefined) {
                    mesh.material.gpuTextures.normal = gpuTextureKeys[tex.normal];
                }
                if (tex.metallicRoughness !== undefined) {
                    mesh.material.gpuTextures.metallicRoughness = gpuTextureKeys[tex.metallicRoughness];
                }
            }
        });
    }

    private recalcMeshInstances(): void {
        this.meshInstances = [];
        if (this.meshModel.nodes && this.meshModel.scenes && this.meshModel.scenes.length > 0) {
            const scene = this.meshModel.scenes[this.meshModel.scene ?? 0];
            if (scene) {
                for (const nodeIndex of scene.nodes) {
                    this.traverse(nodeIndex, bmat.identity());
                }
            }
        } else {
            for (const mesh of this.meshes) {
                this.meshInstances.push({ mesh, matrix: bmat.identity() });
            }
        }
    }

    private traverse(nodeIndex: number, parent: Float32Array): void {
        if (!this.meshModel.nodes) return;
        const world = this.getWorldMatrix(nodeIndex, parent);
        const node: GLTFNode = this.meshModel.nodes[nodeIndex];
        if (node.mesh !== undefined) {
            const mesh = this.meshes[node.mesh];
            if (mesh) this.meshInstances.push({ mesh, matrix: world, skinIndex: node.skin });
        }
        if (node.children) {
            for (const child of node.children) {
                this.traverse(child, world);
            }
        }
    }

    private computeSkinMatrices(skinIndex: number): Float32Array[] {
        const skin = this.meshModel.skins?.[skinIndex];
        if (!skin) return [];
        const mats: Float32Array[] = [];
        for (let i = 0; i < skin.joints.length; i++) {
            const jointIdx = skin.joints[i];
            const jointWorld = this.worldMatrices[jointIdx];
            const inv = skin.inverseBindMatrices?.[i] ?? bmat.identity();
            mats.push(bmat.multiply(jointWorld, inv));
        }
        return mats;
    }

    private getWorldMatrix(nodeIndex: number, parent: Float32Array): Float32Array {
        if (this.nodeDirty[nodeIndex]) {
            const node: GLTFNode = this.meshModel.nodes![nodeIndex];
            const local = node.matrix ? new Float32Array(node.matrix) : this.composeNodeMatrix(node);
            this.worldMatrices[nodeIndex] = bmat.multiply(parent, local);
            this.nodeDirty[nodeIndex] = false;
        }
        return this.worldMatrices[nodeIndex];
    }

    private markNodeDirty(index: number): void {
        if (!this.meshModel.nodes) return;
        const mark = (i: number) => {
            this.nodeDirty[i] = true;
            const n = this.meshModel.nodes![i];
            if (n.children) for (const c of n.children) mark(c);
        };
        mark(index);
    }

    private composeNodeMatrix(node: GLTFNode): Float32Array {
        let m = bmat.identity();
        const t = node.translation ?? [0, 0, 0];
        m = bmat.translate(m, t[0], t[1], t[2]);
        if (node.rotation) {
            m = bmat.multiply(m, quatToMat4(node.rotation));
        }
        const s = node.scale ?? [1, 1, 1];
        m = bmat.scale(m, s[0], s[1], s[2]);
        return m;
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
        if (this.meshInstances.length === 0) return; // No mesh to draw
        const transform = this.getComponent(TransformComponent);
        let base: Float32Array;
        if (transform) {
            base = transform.getWorldMatrix();
        } else {
            base = bmat.identity();
            base = bmat.translate(base, this.x, this.y, this.z);
            base = bmat.rotateX(base, this.rotation[0]);
            base = bmat.rotateY(base, this.rotation[1]);
            base = bmat.rotateZ(base, this.rotation[2]);
            base = bmat.scale(base, this.scale[0], this.scale[1], this.scale[2]);
        }
        for (const inst of this.meshInstances) {
            const mesh = inst.mesh;
            if (!mesh.positions || mesh.positions.length === 0) continue;
            const matrix = bmat.multiply(base, inst.matrix);
            const options: DrawMeshOptions = {
                mesh,
                matrix,
                jointMatrices: inst.skinIndex !== undefined ? this.computeSkinMatrices(inst.skinIndex) : undefined,
            };
            $.view.drawMesh(options);
        }
    }
}

function quatToMat4(q: [number, number, number, number]): Float32Array {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const out = new Float32Array(16);
    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
}
