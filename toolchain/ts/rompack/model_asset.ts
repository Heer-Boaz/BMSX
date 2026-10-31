import { decodeBinary, encodeBinary, typedArrayFromBytes } from '../../../machine/ts/common/serializer/binencoder';
import type { GLTFIndexArray, GLTFModel } from './gltf';

type Packed<T> = T extends ArrayBufferView
	? Uint8Array
	: T extends object ? { [K in keyof T]: Packed<T[K]> } : T;
type ModelPayload = Packed<Omit<GLTFModel, 'imageBuffers'>> & { imageOffsets?: { start: number; end: number }[] };

const INDEX_ARRAY_CONSTRUCTORS = {
	5121: Uint8Array,
	5123: Uint16Array,
	5125: Uint32Array,
};

export function packModelAsset(model: GLTFModel): { buffer: Uint8Array; model_texture_buffer?: Uint8Array } {
	let imageByteLength = 0;
	const imageOffsets = model.imageBuffers?.map(image => {
		const start = imageByteLength;
		imageByteLength += image.byteLength;
		return { start, end: imageByteLength };
	});
	const imageBytes = imageOffsets === undefined ? undefined : new Uint8Array(imageByteLength);
	if (model.imageBuffers !== undefined) {
		for (let i = 0; i < model.imageBuffers.length; i++) {
			imageBytes.set(model.imageBuffers[i], imageOffsets[i].start);
		}
	}
	return {
		buffer: encodeBinary({ ...model, imageBuffers: undefined, imageOffsets }),
		model_texture_buffer: imageBytes,
	};
}

export function loadModelFromBuffer(assetId: string, buffer: Uint8Array, imageBytes?: Uint8Array): GLTFModel {
	const packed = decodeBinary(buffer, { zeroCopyBin: true }) as ModelPayload;
	return {
		name: assetId,
		materials: packed.materials, textures: packed.textures, samplers: packed.samplers,
		imageURIs: packed.imageURIs, scenes: packed.scenes, scene: packed.scene,
		meshes: packed.meshes.map(mesh => ({
			...mesh,
			primitives: mesh.primitives.map(primitive => ({
				...primitive,
				positions: typedArrayFromBytes(primitive.positions, Float32Array),
				texcoords: primitive.texcoords && typedArrayFromBytes(primitive.texcoords, Float32Array),
				texcoords1: primitive.texcoords1 && typedArrayFromBytes(primitive.texcoords1, Float32Array),
				normals: primitive.normals && typedArrayFromBytes(primitive.normals, Float32Array),
				tangents: primitive.tangents && typedArrayFromBytes(primitive.tangents, Float32Array),
				indices: primitive.indices && typedArrayFromBytes<GLTFIndexArray>(primitive.indices, INDEX_ARRAY_CONSTRUCTORS[primitive.indexComponentType]),
				morphPositions: primitive.morphPositions?.map(values => typedArrayFromBytes(values, Float32Array)),
				morphNormals: primitive.morphNormals?.map(values => typedArrayFromBytes(values, Float32Array)),
				morphTangents: primitive.morphTangents?.map(values => typedArrayFromBytes(values, Float32Array)),
				jointIndices: primitive.jointIndices && typedArrayFromBytes(primitive.jointIndices, Uint16Array),
				jointWeights: primitive.jointWeights && typedArrayFromBytes(primitive.jointWeights, Float32Array),
				colors: primitive.colors && typedArrayFromBytes(primitive.colors, Float32Array),
			})),
		})),
		animations: packed.animations?.map(animation => ({
			...animation,
			samplers: animation.samplers.map(sampler => ({
				...sampler,
				input: typedArrayFromBytes(sampler.input, Float32Array),
				output: typedArrayFromBytes(sampler.output, Float32Array),
			})),
		})),
		nodes: packed.nodes?.map(node => ({
			...node,
			matrix: node.matrix && typedArrayFromBytes(node.matrix, Float32Array),
		})),
		skins: packed.skins?.map(skin => ({
			...skin,
			inverseBindMatrices: skin.inverseBindMatrices?.map(matrix => typedArrayFromBytes(matrix, Float32Array)),
		})),
		imageBuffers: packed.imageOffsets?.map(range => imageBytes.subarray(range.start, range.end)),
	};
}
