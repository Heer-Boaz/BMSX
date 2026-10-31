import { decodeBinary, encodeBinary, typedArrayFromBytes } from '../../../machine/ts/common/serializer/binencoder';
import { alignRomAssetOffset } from './asset_layout';
import type { GLTFIndexArray, GLTFMesh, GLTFModel, GLTFPrimitive } from './gltf';
import {
	MODEL_ASSET_HEADER, MODEL_ASSET_HEADER_BYTE_LENGTH,
	MODEL_MESH, MODEL_MESH_BYTE_LENGTH,
	MODEL_PRIMITIVE, MODEL_PRIMITIVE_BYTE_LENGTH,
	MODEL_SCENE, MODEL_SCENE_BYTE_LENGTH, MODEL_PART, MODEL_PART_BYTE_LENGTH, MODEL_MATERIAL, MODEL_MATERIAL_BYTE_LENGTH,
} from './model_asset_layout';
import { prepareModelStaticScenes } from './model_static_scene';

type Packed<T> = T extends ArrayBufferView
	? Uint8Array
	: T extends object ? { [K in keyof T]: Packed<T[K]> } : T;
type PrimitivePayload = Packed<Omit<GLTFPrimitive, 'positions' | 'indices'>>;
type MeshPayload = Packed<Omit<GLTFMesh, 'primitives'>> & { primitives: PrimitivePayload[] };
type ModelPayload = Packed<Omit<GLTFModel, 'imageBuffers' | 'meshes'>> & {
	meshes: MeshPayload[];
	imageOffsets?: { start: number; end: number }[];
};

const INDEX_ARRAY_CONSTRUCTORS: Readonly<Record<number, Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor>> = {
	5121: Uint8Array,
	5123: Uint16Array,
	5125: Uint32Array,
};

export function packModelAsset(model: GLTFModel): { buffer: Uint8Array; model_texture_buffer?: Uint8Array } {
	const staticScene = prepareModelStaticScenes(model);
	let primitiveCount = 0;
	let geometryByteLength = 0;
	const streamOffsets = new Map<ArrayBufferView, number>();
	const meshes = model.meshes.map(mesh => ({
		...mesh,
		primitives: mesh.primitives.map(({ positions, indices, ...primitive }) => {
			primitiveCount += 1;
			if (streamOffsets.get(positions) === undefined) {
				streamOffsets.set(positions, geometryByteLength);
				geometryByteLength += alignRomAssetOffset(positions.byteLength);
			}
			if (indices !== undefined && streamOffsets.get(indices) === undefined) {
				streamOffsets.set(indices, geometryByteLength);
				geometryByteLength += alignRomAssetOffset(indices.byteLength);
			}
			return primitive;
		}),
	}));
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
	const rich = encodeBinary({ ...model, meshes, imageBuffers: undefined, imageOffsets });
	const meshDirectoryOffset = MODEL_ASSET_HEADER_BYTE_LENGTH;
	const primitiveDirectoryOffset = meshDirectoryOffset + model.meshes.length * MODEL_MESH_BYTE_LENGTH;
	const sceneDirectoryOffset = primitiveDirectoryOffset + primitiveCount * MODEL_PRIMITIVE_BYTE_LENGTH;
	const partDirectoryOffset = sceneDirectoryOffset + staticScene.scenes.length * MODEL_SCENE_BYTE_LENGTH;
	const materialDirectoryOffset = partDirectoryOffset + staticScene.parts.length * MODEL_PART_BYTE_LENGTH;
	const geometryOffset = materialDirectoryOffset + staticScene.materials.length * MODEL_MATERIAL_BYTE_LENGTH;
	const richOffset = geometryOffset + geometryByteLength;
	const buffer = new Uint8Array(richOffset + rich.byteLength);
	const view = new DataView(buffer.buffer);
	view.setUint32(MODEL_ASSET_HEADER.richOffset, richOffset, true);
	view.setUint32(MODEL_ASSET_HEADER.richLength, rich.byteLength, true);
	view.setUint32(MODEL_ASSET_HEADER.meshDirectoryOffset, meshDirectoryOffset, true);
	view.setUint32(MODEL_ASSET_HEADER.meshCount, model.meshes.length, true);
	view.setUint32(MODEL_ASSET_HEADER.primitiveDirectoryOffset, primitiveDirectoryOffset, true);
	view.setUint32(MODEL_ASSET_HEADER.primitiveCount, primitiveCount, true);
	view.setUint32(MODEL_ASSET_HEADER.sceneDirectoryOffset, sceneDirectoryOffset, true);
	view.setUint32(MODEL_ASSET_HEADER.sceneCount, staticScene.scenes.length, true);
	view.setUint32(MODEL_ASSET_HEADER.partDirectoryOffset, partDirectoryOffset, true);
	view.setUint32(MODEL_ASSET_HEADER.partCount, staticScene.parts.length, true);
	view.setUint32(MODEL_ASSET_HEADER.materialDirectoryOffset, materialDirectoryOffset, true);
	view.setUint32(MODEL_ASSET_HEADER.materialCount, staticScene.materials.length, true);
	view.setUint32(MODEL_ASSET_HEADER.defaultScene, model.scene ?? 0xffffffff, true);
	for (let index = 0; index < staticScene.scenes.length; index++) {
		const scene = staticScene.scenes[index], offset = sceneDirectoryOffset + index * MODEL_SCENE_BYTE_LENGTH;
		view.setUint32(offset + MODEL_SCENE.firstPart, scene.firstPart, true);
		view.setUint32(offset + MODEL_SCENE.partCount, scene.partCount, true);
		view.setUint32(offset + MODEL_SCENE.features, scene.features, true);
	}
	for (let index = 0; index < staticScene.parts.length; index++) {
		const part = staticScene.parts[index], offset = partDirectoryOffset + index * MODEL_PART_BYTE_LENGTH;
		view.setUint32(offset + MODEL_PART.node, part.node, true);
		view.setUint32(offset + MODEL_PART.mesh, part.mesh, true);
		const a = part.affine;
		const coefficients = [a.xx,a.xy,a.xz,a.yx,a.yy,a.yz,a.zx,a.zy,a.zz,a.ox,a.oy,a.oz];
		for (let field = 0; field < coefficients.length; field++) view.setFloat64(offset + MODEL_PART.affine + field * 8, coefficients[field], true);
	}
	for (let index = 0; index < staticScene.materials.length; index++) {
		const material = staticScene.materials[index], offset = materialDirectoryOffset + index * MODEL_MATERIAL_BYTE_LENGTH;
		view.setUint32(offset + MODEL_MATERIAL.command, material.command, true);
		view.setUint32(offset + MODEL_MATERIAL.doubleSided, material.doubleSided ? 1 : 0, true);
	}
	let primitiveIndex = 0;
	for (let meshIndex = 0; meshIndex < model.meshes.length; meshIndex++) {
		const mesh = model.meshes[meshIndex];
		const meshOffset = meshDirectoryOffset + meshIndex * MODEL_MESH_BYTE_LENGTH;
		view.setUint32(meshOffset + MODEL_MESH.firstPrimitive, primitiveIndex, true);
		view.setUint32(meshOffset + MODEL_MESH.primitiveCount, mesh.primitives.length, true);
		for (const primitive of mesh.primitives) {
			const primitiveOffset = primitiveDirectoryOffset + primitiveIndex * MODEL_PRIMITIVE_BYTE_LENGTH;
			view.setUint32(primitiveOffset + MODEL_PRIMITIVE.positionsOffset, geometryOffset + streamOffsets.get(primitive.positions)!, true);
			view.setUint32(primitiveOffset + MODEL_PRIMITIVE.positionScalarCount, primitive.positions.length, true);
			view.setUint32(primitiveOffset + MODEL_PRIMITIVE.indicesOffset,
				primitive.indices === undefined ? 0 : geometryOffset + streamOffsets.get(primitive.indices)!, true);
			view.setUint32(primitiveOffset + MODEL_PRIMITIVE.indexCount, primitive.indices?.length ?? 0, true);
			view.setUint32(primitiveOffset + MODEL_PRIMITIVE.indexComponentType, primitive.indexComponentType ?? 0, true);
			view.setUint32(primitiveOffset + MODEL_PRIMITIVE.materialIndex, primitive.materialIndex ?? 0xffffffff, true);
			primitiveIndex += 1;
		}
	}
	for (const [stream, offset] of streamOffsets) {
		buffer.set(new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength), geometryOffset + offset);
	}
	buffer.set(rich, richOffset);
	return {
		buffer,
		model_texture_buffer: imageBytes,
	};
}

export function loadModelFromBuffer(assetId: string, buffer: Uint8Array, imageBytes?: Uint8Array): GLTFModel {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const richOffset = view.getUint32(MODEL_ASSET_HEADER.richOffset, true);
	const richLength = view.getUint32(MODEL_ASSET_HEADER.richLength, true);
	const meshDirectoryOffset = view.getUint32(MODEL_ASSET_HEADER.meshDirectoryOffset, true);
	const primitiveDirectoryOffset = view.getUint32(MODEL_ASSET_HEADER.primitiveDirectoryOffset, true);
	const packed = decodeBinary(buffer.subarray(richOffset, richOffset + richLength), { zeroCopyBin: true }) as ModelPayload;
	return {
		name: assetId,
		materials: packed.materials, textures: packed.textures, samplers: packed.samplers,
		imageURIs: packed.imageURIs, scenes: packed.scenes, scene: packed.scene,
		meshes: packed.meshes.map((mesh, meshIndex) => {
			const firstPrimitive = view.getUint32(meshDirectoryOffset + meshIndex * MODEL_MESH_BYTE_LENGTH + MODEL_MESH.firstPrimitive, true);
			return {
				...mesh,
				primitives: mesh.primitives.map((primitive, primitiveIndex) => {
					const primitiveOffset = primitiveDirectoryOffset + (firstPrimitive + primitiveIndex) * MODEL_PRIMITIVE_BYTE_LENGTH;
					const positionsOffset = view.getUint32(primitiveOffset + MODEL_PRIMITIVE.positionsOffset, true);
					const positionScalarCount = view.getUint32(primitiveOffset + MODEL_PRIMITIVE.positionScalarCount, true);
					const indicesOffset = view.getUint32(primitiveOffset + MODEL_PRIMITIVE.indicesOffset, true);
					const indexCount = view.getUint32(primitiveOffset + MODEL_PRIMITIVE.indexCount, true);
					const IndexArray = INDEX_ARRAY_CONSTRUCTORS[view.getUint32(primitiveOffset + MODEL_PRIMITIVE.indexComponentType, true)];
					return {
						...primitive,
						positions: typedArrayFromBytes(buffer.subarray(positionsOffset, positionsOffset + positionScalarCount * Float32Array.BYTES_PER_ELEMENT), Float32Array),
						texcoords: primitive.texcoords && typedArrayFromBytes(primitive.texcoords, Float32Array),
						texcoords1: primitive.texcoords1 && typedArrayFromBytes(primitive.texcoords1, Float32Array),
						normals: primitive.normals && typedArrayFromBytes(primitive.normals, Float32Array),
						tangents: primitive.tangents && typedArrayFromBytes(primitive.tangents, Float32Array),
						indices: indicesOffset === 0 ? undefined : typedArrayFromBytes<GLTFIndexArray>(buffer.subarray(indicesOffset, indicesOffset + indexCount * IndexArray.BYTES_PER_ELEMENT), IndexArray),
						morphPositions: primitive.morphPositions?.map(values => typedArrayFromBytes(values, Float32Array)),
						morphNormals: primitive.morphNormals?.map(values => typedArrayFromBytes(values, Float32Array)),
						morphTangents: primitive.morphTangents?.map(values => typedArrayFromBytes(values, Float32Array)),
						jointIndices: primitive.jointIndices && typedArrayFromBytes(primitive.jointIndices, Uint16Array),
						jointWeights: primitive.jointWeights && typedArrayFromBytes(primitive.jointWeights, Float32Array),
						colors: primitive.colors && typedArrayFromBytes(primitive.colors, Float32Array),
					};
				}),
			};
		}),
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
			matrix: node.matrix && typedArrayFromBytes(node.matrix, Float64Array),
		})),
		skins: packed.skins?.map(skin => ({
			...skin,
			inverseBindMatrices: skin.inverseBindMatrices?.map(matrix => typedArrayFromBytes(matrix, Float32Array)),
		})),
		imageBuffers: packed.imageOffsets?.map(range => imageBytes.subarray(range.start, range.end)),
	};
}
