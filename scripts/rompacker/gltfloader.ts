import type { GLTFMesh, GLTFModel, GLTFNode, GLTFScene, GLTFSkin } from '../../src/bmsx/rompack/rompack';
const { join } = require('path');
const { readFile } = require('fs/promises');

export async function loadGLTFModel(data: string, dir: string, resname: string): Promise<GLTFModel> {
    const json = JSON.parse(data);

    async function getBuffer(uri: string): Promise<Uint8Array> {
        if (uri.startsWith('data:')) {
            const base64 = uri.split(',')[1];
            return Uint8Array.from(Buffer.from(base64, 'base64'));
        } else {
            const data = await readFile(join(dir, uri));
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
    }

    const buffers = await Promise.all((json.buffers || []).map((b: any) => {
        if (!b.uri) throw new Error('Buffer without URI');
        return getBuffer(b.uri);
    }));

    const imageURIs: string[] = [];
    const imageBuffers: Uint8Array[] = [];
    if (Array.isArray(json.images)) {
        for (const img of json.images) {
            if (img.uri) {
                imageURIs.push(img.uri);
                imageBuffers.push(await getBuffer(img.uri));
            }
        }
    }

    const accessors = json.accessors || [];
    const bufferViews = json.bufferViews || [];

    function numComponents(type: string): number {
        switch (type) {
            case 'SCALAR': return 1;
            case 'VEC2': return 2;
            case 'VEC3': return 3;
            case 'VEC4': return 4;
            case 'MAT2': return 4;
            case 'MAT3': return 9;
            case 'MAT4': return 16;
            default: return 3;
        }
    }

    function componentSize(componentType: number): number {
        switch (componentType) {
            case 5120: // BYTE
            case 5121: // UNSIGNED_BYTE
                return 1;
            case 5122: // SHORT
            case 5123: // UNSIGNED_SHORT
                return 2;
            case 5125: // UNSIGNED_INT
            case 5126: // FLOAT
                return 4;
            default: return 4;
        }
    }

    function getAccessorData(i: number): Float32Array | Uint16Array | Uint32Array | Uint8Array {
        const acc = accessors[i];
        const view = bufferViews[acc.bufferView];
        const buf = buffers[view.buffer];
        const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
        const length = acc.count * numComponents(acc.type) * componentSize(acc.componentType);
        const slice = buf.subarray(offset, offset + length);
        switch (acc.componentType) {
            case 5126:
                return new Float32Array(slice.buffer, slice.byteOffset, length / 4);
            case 5121:
                return new Uint8Array(slice.buffer, slice.byteOffset, length);
            case 5123:
                return new Uint16Array(slice.buffer, slice.byteOffset, length / 2);
            case 5125:
                return new Uint32Array(slice.buffer, slice.byteOffset, length / 4);
            default:
                return new Float32Array(slice.buffer, slice.byteOffset, length / 4);
        }
    }

    const textures = json.textures || [];
    const textureSources: number[] = textures.map((t: any) => t.source ?? -1);

    const materials = (json.materials || []).map((m: any) => ({
        baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor,
        metallicFactor: m.pbrMetallicRoughness?.metallicFactor,
        roughnessFactor: m.pbrMetallicRoughness?.roughnessFactor,
        baseColorTexture: m.pbrMetallicRoughness?.baseColorTexture?.index,
        normalTexture: m.normalTexture?.index,
        metallicRoughnessTexture: m.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
    }));

    const meshes: GLTFMesh[] = [];
    for (const mesh of json.meshes || []) {
        for (const prim of mesh.primitives || []) {
            const posTargets: Float32Array[] = [];
            const normTargets: Float32Array[] = [];
            const tanTargets: Float32Array[] = [];
            for (const t of prim.targets || []) {
                posTargets.push(t.POSITION !== undefined ? getAccessorData(t.POSITION) as Float32Array : new Float32Array());
                normTargets.push(t.NORMAL !== undefined ? getAccessorData(t.NORMAL) as Float32Array : new Float32Array());
                tanTargets.push(t.TANGENT !== undefined ? getAccessorData(t.TANGENT) as Float32Array : new Float32Array());
            }
            let jointIndices: Uint16Array | undefined;
            if (prim.attributes.JOINTS_0 !== undefined) {
                const j = getAccessorData(prim.attributes.JOINTS_0);
                jointIndices = j instanceof Uint16Array ? j : new Uint16Array(j as Uint8Array);
            }
            let jointWeights: Float32Array | undefined;
            if (prim.attributes.WEIGHTS_0 !== undefined) {
                const acc = accessors[prim.attributes.WEIGHTS_0];
                const w = getAccessorData(prim.attributes.WEIGHTS_0);
                if (w instanceof Float32Array) {
                    jointWeights = w;
                } else if (w instanceof Uint16Array) {
                    jointWeights = new Float32Array(w.length);
                    const denom = acc.componentType === 5123 ? 65535 : 255;
                    for (let i = 0; i < w.length; i++) jointWeights[i] = w[i] / denom;
                } else if (w instanceof Uint8Array) {
                    jointWeights = new Float32Array(w.length);
                    for (let i = 0; i < w.length; i++) jointWeights[i] = w[i] / 255;
                }
            }
            const m: GLTFMesh = {
                positions: getAccessorData(prim.attributes.POSITION) as Float32Array,
                texcoords: prim.attributes.TEXCOORD_0 !== undefined ? getAccessorData(prim.attributes.TEXCOORD_0) as Float32Array : undefined,
                normals: prim.attributes.NORMAL !== undefined ? getAccessorData(prim.attributes.NORMAL) as Float32Array : null,
                tangents: prim.attributes.TANGENT !== undefined ? getAccessorData(prim.attributes.TANGENT) as Float32Array : null,
                indices: prim.indices !== undefined ? (getAccessorData(prim.indices) as any) : undefined,
                indexComponentType: prim.indices !== undefined ? accessors[prim.indices].componentType : undefined,
                materialIndex: prim.material,
                morphPositions: posTargets.length ? posTargets : undefined,
                morphNormals: normTargets.some(a => a.length) ? normTargets : undefined,
                morphTangents: tanTargets.some(a => a.length) ? tanTargets : undefined,
                weights: mesh.weights ? Array.from(mesh.weights) : posTargets.length ? new Array(posTargets.length).fill(0) : undefined,
                jointIndices,
                jointWeights,
            };
            meshes.push(m);
        }
    }

    const animations = (json.animations || []).map((a: any) => ({
        name: a.name,
        samplers: (a.samplers || []).map((s: any) => ({
            interpolation: s.interpolation || 'LINEAR',
            input: getAccessorData(s.input) as Float32Array,
            output: getAccessorData(s.output) as Float32Array,
        })),
        channels: a.channels || [],
    }));

    const nodes: GLTFNode[] = (json.nodes || []).map((n: any) => ({
        mesh: n.mesh,
        children: n.children,
        translation: n.translation,
        rotation: n.rotation,
        scale: n.scale,
        matrix: n.matrix ? new Float32Array(n.matrix) : undefined,
        skin: n.skin,
    }));

    const scenes: GLTFScene[] = (json.scenes || []).map((s: any) => ({ nodes: s.nodes || [] }));
    const scene: number | undefined = json.scene;
    const skins: GLTFSkin[] = (json.skins || []).map((s: any) => ({
        joints: s.joints || [],
        inverseBindMatrices: s.inverseBindMatrices !== undefined ? (() => {
            const buf = getAccessorData(s.inverseBindMatrices) as Float32Array;
            const mats: Float32Array[] = [];
            for (let i = 0; i < buf.length; i += 16) mats.push(buf.slice(i, i + 16));
            return mats;
        })() : undefined,
    }));
    const model: GLTFModel = { name: resname, meshes, materials, animations, imageURIs, textures: textureSources, nodes, scenes, scene, skins };
    model.imageBuffers = imageBuffers.map(buf => {
        const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return arr.slice().buffer as ArrayBuffer;
    });

    validateGLTFModel(model);
    return model;
}

function validateGLTFModel(model: GLTFModel): void {
    if (!model.meshes || model.meshes.length === 0) {
        throw new Error('GLTF model has no meshes');
    }
    for (const m of model.meshes) {
        if (!(m.positions && m.positions.length)) {
            throw new Error('Mesh is missing vertex positions');
        }
        if (m.indices && m.indices.length === 0) {
            throw new Error('Mesh indices array is empty');
        }
        if (m.indices && m.indexComponentType !== undefined && m.indexComponentType !== 5123 && m.indexComponentType !== 5125) {
            throw new Error('Mesh has unsupported index component type');
        }
        if (m.materialIndex !== undefined && model.materials && m.materialIndex >= model.materials.length) {
            throw new Error(`Mesh references invalid material index ${m.materialIndex}`);
        }
    }
    if (model.animations) {
        for (const anim of model.animations) {
            if (!Array.isArray(anim.samplers) || !Array.isArray(anim.channels)) {
                throw new Error('Invalid animation structure');
            }
        }
    }
    if (model.nodes) {
        for (const node of model.nodes) {
            if (node.mesh !== undefined && node.mesh >= model.meshes.length) {
                throw new Error(`Node references invalid mesh index ${node.mesh}`);
            }
            if (node.skin !== undefined && model.skins && node.skin >= model.skins.length) {
                throw new Error(`Node references invalid skin index ${node.skin}`);
            }
        }
    }
    if (model.skins) {
        for (const skin of model.skins) {
            for (const j of skin.joints) {
                if (model.nodes && j >= model.nodes.length) {
                    throw new Error(`Skin joint index ${j} invalid`);
                }
            }
        }
    }
}
