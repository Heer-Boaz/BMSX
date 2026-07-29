import type { vec3arr, vec4arr } from '../../common/vector';

export interface GLTFMaterial {
	baseColorFactor?: vec4arr;
	metallicFactor?: number;
	roughnessFactor?: number;
	baseColorTexture?: number;
	baseColorTexCoord?: number;
	normalTexture?: number;
	normalTexCoord?: number;
	normalScale?: number;
	metallicRoughnessTexture?: number;
	metallicRoughnessTexCoord?: number;
	occlusionTexture?: number;
	occlusionTexCoord?: number;
	occlusionStrength?: number;
	emissiveTexture?: number;
	emissiveTexCoord?: number;
	emissiveFactor?: vec4arr;
	alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
	alphaCutoff?: number;
	doubleSided?: boolean;
	unlit?: boolean;
}

export type GLTFIndexArray = Uint8Array | Uint16Array | Uint32Array;

export interface GLTFMesh {
	positions: Float32Array;
	texcoords?: Float32Array;
	texcoords1?: Float32Array;
	normals?: Float32Array;
	tangents?: Float32Array;
	indices?: GLTFIndexArray;
	indexComponentType?: 5121 | 5123 | 5125;
	materialIndex?: number;
	morphPositions?: Float32Array[];
	morphNormals?: Float32Array[];
	morphTangents?: Float32Array[];
	weights?: number[];
	jointIndices?: Uint16Array;
	jointWeights?: Float32Array;
	colors?: Float32Array;
}

export interface GLTFAnimationSampler {
	interpolation: string;
	input: Float32Array;
	output: Float32Array;
}

export interface GLTFAnimationChannel {
	sampler: number;
	target: { node?: number; path: string };
}

export interface GLTFAnimation {
	name?: string;
	samplers: GLTFAnimationSampler[];
	channels: GLTFAnimationChannel[];
}

export interface GLTFNode {
	mesh?: number;
	children?: number[];
	translation?: vec3arr;
	rotation?: vec4arr;
	scale?: vec3arr;
	matrix?: Float32Array;
	skin?: number;
	weights?: number[];
	visible?: boolean;
}

export interface GLTFScene {
	nodes: number[];
}

export interface GLTFSkin {
	joints: number[];
	inverseBindMatrices?: Float32Array[];
}

export interface GLTFModel {
	name: string;
	meshes: GLTFMesh[];
	materials?: GLTFMaterial[];
	animations?: GLTFAnimation[];
	textures?: number[];
	imageURIs?: string[];
	imageOffsets?: { start: number; end: number }[];
	imageBuffers?: ArrayBuffer[];
	gpuTextures?: Record<number, string>;
	nodes?: GLTFNode[];
	scenes?: GLTFScene[];
	scene?: number;
	skins?: GLTFSkin[];
}
