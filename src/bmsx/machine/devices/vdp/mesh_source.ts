import type { GLTFMaterial, GLTFMesh, GLTFModel, RomAsset } from '../../../rompack/format';
import type { RuntimeRomLayer } from '../../../rompack/loader';
import {
	CART_ROM_BASE,
	OVERLAY_ROM_BASE,
	SYSTEM_ROM_BASE,
} from '../../memory/map';
import { VDP_MDU_MATERIAL_MESH_DEFAULT } from './contracts';

export const VDP_MESH_ALPHA_OPAQUE = 0;
export const VDP_MESH_ALPHA_MASK = 1;
export const VDP_MESH_ALPHA_BLEND = 2;

const EMPTY_F32 = new Float32Array(0);
const EMPTY_U16 = new Uint16Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_MORPH_TARGETS: readonly Float32Array[] = [];

export type VdpMeshIndexArray = Uint8Array | Uint16Array | Uint32Array;

export type VdpMeshSourceMaterial = {
	baseColor0: number;
	baseColor1: number;
	baseColor2: number;
	baseColor3: number;
	metallicFactor: number;
	roughnessFactor: number;
	emissive0: number;
	emissive1: number;
	emissive2: number;
	alphaMode: number;
	alphaCutoff: number;
	doubleSided: boolean;
	unlit: boolean;
};

export type VdpMeshSourceMesh = {
	positions: Float32Array;
	texcoords: Float32Array;
	normals: Float32Array;
	indices: VdpMeshIndexArray;
	hasIndices: boolean;
	materialIndex: number;
	morphPositions: readonly Float32Array[];
	morphNormals: readonly Float32Array[];
	jointIndices: Uint16Array;
	jointWeights: Float32Array;
	colors: Float32Array;
};

export type VdpMeshSourceModel = {
	meshes: readonly VdpMeshSourceMesh[];
	materials: readonly VdpMeshSourceMaterial[];
};

export const VDP_EMPTY_MESH_SOURCE_MATERIAL: VdpMeshSourceMaterial = {
	baseColor0: 1,
	baseColor1: 1,
	baseColor2: 1,
	baseColor3: 1,
	metallicFactor: 1,
	roughnessFactor: 1,
	emissive0: 0,
	emissive1: 0,
	emissive2: 0,
	alphaMode: VDP_MESH_ALPHA_OPAQUE,
	alphaCutoff: 0.5,
	doubleSided: false,
	unlit: false,
};

export const VDP_EMPTY_MESH_SOURCE_MESH: VdpMeshSourceMesh = {
	positions: EMPTY_F32,
	texcoords: EMPTY_F32,
	normals: EMPTY_F32,
	indices: EMPTY_U32,
	hasIndices: false,
	materialIndex: VDP_MDU_MATERIAL_MESH_DEFAULT,
	morphPositions: EMPTY_MORPH_TARGETS,
	morphNormals: EMPTY_MORPH_TARGETS,
	jointIndices: EMPTY_U16,
	jointWeights: EMPTY_F32,
	colors: EMPTY_F32,
};

export const VDP_EMPTY_MESH_SOURCE_MODEL: VdpMeshSourceModel = {
	meshes: [],
	materials: [],
};

export class VdpMeshSourceBank {
	private readonly modelsBySourceAddr = new Map<number, VdpMeshSourceModel>();

	public clear(): void {
		this.modelsBySourceAddr.clear();
	}

	public registerSource(sourceAddr: number, source: VdpMeshSourceModel): void {
		this.modelsBySourceAddr.set(sourceAddr >>> 0, source);
	}

	public resolveSource(sourceAddr: number): VdpMeshSourceModel {
		const source = this.modelsBySourceAddr.get(sourceAddr >>> 0);
		if (source !== undefined) {
			return source;
		}
		return VDP_EMPTY_MESH_SOURCE_MODEL;
	}
}

function meshAlphaMode(alphaMode: GLTFMaterial['alphaMode']): number {
	switch (alphaMode) {
		case 'MASK': return VDP_MESH_ALPHA_MASK;
		case 'BLEND': return VDP_MESH_ALPHA_BLEND;
		case 'OPAQUE':
		case undefined: return VDP_MESH_ALPHA_OPAQUE;
	}
	return VDP_MESH_ALPHA_OPAQUE;
}

function createVdpMeshSourceMaterial(material: GLTFMaterial): VdpMeshSourceMaterial {
	const color = material.baseColorFactor;
	const emissive = material.emissiveFactor;
	return {
		baseColor0: color ? color[0] : 1,
		baseColor1: color ? color[1] : 1,
		baseColor2: color ? color[2] : 1,
		baseColor3: color ? color[3] : 1,
		metallicFactor: material.metallicFactor !== undefined ? material.metallicFactor : 1,
		roughnessFactor: material.roughnessFactor !== undefined ? material.roughnessFactor : 1,
		emissive0: emissive ? emissive[0] : 0,
		emissive1: emissive ? emissive[1] : 0,
		emissive2: emissive ? emissive[2] : 0,
		alphaMode: meshAlphaMode(material.alphaMode),
		alphaCutoff: material.alphaCutoff !== undefined ? material.alphaCutoff : 0.5,
		doubleSided: !!material.doubleSided,
		unlit: !!material.unlit,
	};
}

function createVdpMeshSourceMesh(mesh: GLTFMesh): VdpMeshSourceMesh {
	return {
		positions: mesh.positions,
		texcoords: mesh.texcoords !== undefined ? mesh.texcoords : EMPTY_F32,
		normals: mesh.normals !== undefined ? mesh.normals : EMPTY_F32,
		indices: mesh.indices !== undefined ? mesh.indices : EMPTY_U32,
		hasIndices: mesh.indices !== undefined,
		materialIndex: mesh.materialIndex !== undefined ? mesh.materialIndex >>> 0 : VDP_MDU_MATERIAL_MESH_DEFAULT,
		morphPositions: mesh.morphPositions !== undefined ? mesh.morphPositions : EMPTY_MORPH_TARGETS,
		morphNormals: mesh.morphNormals !== undefined ? mesh.morphNormals : EMPTY_MORPH_TARGETS,
		jointIndices: mesh.jointIndices !== undefined ? mesh.jointIndices : EMPTY_U16,
		jointWeights: mesh.jointWeights !== undefined ? mesh.jointWeights : EMPTY_F32,
		colors: mesh.colors !== undefined ? mesh.colors : EMPTY_F32,
	};
}

export function createVdpMeshSourceModel(model: GLTFModel): VdpMeshSourceModel {
	const meshes = new Array<VdpMeshSourceMesh>(model.meshes.length);
	for (let index = 0; index < model.meshes.length; index += 1) {
		meshes[index] = createVdpMeshSourceMesh(model.meshes[index]);
	}
	const sourceMaterials = model.materials !== undefined ? model.materials : [];
	const materials = new Array<VdpMeshSourceMaterial>(sourceMaterials.length);
	for (let index = 0; index < sourceMaterials.length; index += 1) {
		materials[index] = createVdpMeshSourceMaterial(sourceMaterials[index]);
	}
	return { meshes, materials };
}

function romBaseForPayload(payloadId: RomAsset['payload_id']): number {
	switch (payloadId) {
		case 'system': return SYSTEM_ROM_BASE;
		case 'overlay': return OVERLAY_ROM_BASE;
		case 'cart': return CART_ROM_BASE;
	}
	return CART_ROM_BASE;
}

function romAssetSourceAddr(entry: RomAsset): number {
	return (romBaseForPayload(entry.payload_id) + entry.start!) >>> 0;
}

export function configureVdpMeshSourcesFromRomLayers(
	bank: VdpMeshSourceBank,
	systemRom: RuntimeRomLayer,
	cartRom: RuntimeRomLayer | null,
	overlayRom: RuntimeRomLayer | null,
): void {
	bank.clear();
	registerVdpMeshSourcesFromRomLayer(bank, systemRom);
	if (cartRom) {
		registerVdpMeshSourcesFromRomLayer(bank, cartRom);
	}
	if (overlayRom) {
		registerVdpMeshSourcesFromRomLayer(bank, overlayRom);
	}
}

function registerVdpMeshSourcesFromRomLayer(bank: VdpMeshSourceBank, layer: RuntimeRomLayer): void {
	const entries = layer.index.entries;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type === 'model' && entry.op !== 'delete') {
			const model = layer.package.model[entry.resid];
			if (model !== undefined) {
				bank.registerSource(romAssetSourceAddr(entry), createVdpMeshSourceModel(model));
			}
		}
	}
}
