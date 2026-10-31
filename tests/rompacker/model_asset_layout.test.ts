import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBinary } from '../../machine/ts/common/serializer/binencoder';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { loadModelFromBuffer, packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import {
	MODEL_ASSET_HEADER, MODEL_ASSET_HEADER_BYTE_LENGTH,
	MODEL_MESH, MODEL_MESH_BYTE_LENGTH,
	MODEL_PRIMITIVE, MODEL_PRIMITIVE_BYTE_LENGTH,
} from '../../toolchain/ts/rompack/model_asset_layout';

test('model directories expose one aligned geometry generation without deserializing rich fields', () => {
	const positionWords = new Uint32Array([0x80000000, 0x7fa12345, 0x3f800000]);
	const positions = new Float32Array(positionWords.buffer);
	const indices8 = new Uint8Array([0xa5, 0, 1, 2, 0x5a]).subarray(1, 4);
	const indices16 = new Uint16Array([0xffff, 0, 0xffff, 0x8000, 0xffff]).subarray(1, 4);
	const indices32 = new Uint32Array([0xa5a5a5a5, 0, 0xffffffff, 0x80000001, 0x5a5a5a5a]).subarray(1, 4);
	const model: GLTFModel = {
		name: 'layout',
		materials: [{}],
		meshes: [
			{ name: 'empty', primitives: [] },
			{ primitives: [
				{ positions, indices: indices8, indexComponentType: 5121, materialIndex: 0 },
				{ positions, indices: indices16, indexComponentType: 5123 },
				{ positions, indices: indices32, indexComponentType: 5125 },
			] },
			{ primitives: [
				{ positions: new Float32Array([2, 3, 4]) },
				{ positions: new Float32Array(), indices: new Uint8Array(), indexComponentType: 5121 },
			] },
		],
		nodes: [{ mesh: 1, children: [1] }, { mesh: 2, translation: [2, 3, 4] }, { mesh: 1 }],
		scenes: [{ nodes: [0, 2] }], scene: 0,
	};
	const { buffer } = packModelAsset(model);
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const richOffset = view.getUint32(MODEL_ASSET_HEADER.richOffset, true);
	const richLength = view.getUint32(MODEL_ASSET_HEADER.richLength, true);
	const meshDirectoryOffset = view.getUint32(MODEL_ASSET_HEADER.meshDirectoryOffset, true);
	const primitiveDirectoryOffset = view.getUint32(MODEL_ASSET_HEADER.primitiveDirectoryOffset, true);
	assert.equal(MODEL_ASSET_HEADER_BYTE_LENGTH, 52);
	assert.equal(MODEL_MESH_BYTE_LENGTH, 8);
	assert.equal(MODEL_PRIMITIVE_BYTE_LENGTH, 24);
	assert.equal(meshDirectoryOffset, MODEL_ASSET_HEADER_BYTE_LENGTH);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.meshCount, true), 3);
	assert.equal(primitiveDirectoryOffset, meshDirectoryOffset + 3 * MODEL_MESH_BYTE_LENGTH);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.primitiveCount, true), 5);
	assert.equal(richOffset % 4, 0);
	assert.equal(buffer.byteLength, richOffset + richLength);
	for (const [index, firstPrimitive, primitiveCount] of [[0, 0, 0], [1, 0, 3], [2, 3, 2]]) {
		const offset = meshDirectoryOffset + index * MODEL_MESH_BYTE_LENGTH;
		assert.equal(view.getUint32(offset + MODEL_MESH.firstPrimitive, true), firstPrimitive);
		assert.equal(view.getUint32(offset + MODEL_MESH.primitiveCount, true), primitiveCount);
	}
	const loaded = loadModelFromBuffer('layout', buffer);
	let primitiveIndex = 0;
	let sharedPositionOffset = 0;
	for (let meshIndex = 0; meshIndex < model.meshes.length; meshIndex++) {
		for (let localIndex = 0; localIndex < model.meshes[meshIndex].primitives.length; localIndex++) {
			const original = model.meshes[meshIndex].primitives[localIndex];
			const primitive = loaded.meshes[meshIndex].primitives[localIndex];
			const offset = primitiveDirectoryOffset + primitiveIndex * MODEL_PRIMITIVE_BYTE_LENGTH;
			const positionsOffset = view.getUint32(offset + MODEL_PRIMITIVE.positionsOffset, true);
			const indicesOffset = view.getUint32(offset + MODEL_PRIMITIVE.indicesOffset, true);
			assert.equal(positionsOffset % 4, 0);
			assert.equal(view.getUint32(offset + MODEL_PRIMITIVE.positionScalarCount, true), original.positions.length);
			assert.deepEqual(buffer.subarray(positionsOffset, positionsOffset + original.positions.byteLength),
				new Uint8Array(original.positions.buffer, original.positions.byteOffset, original.positions.byteLength));
			assert.equal(primitive.positions.buffer, buffer.buffer);
			assert.equal(primitive.positions.byteOffset, buffer.byteOffset + positionsOffset);
			assert.equal(view.getUint32(offset + MODEL_PRIMITIVE.materialIndex, true), original.materialIndex ?? 0xffffffff);
			if (original.positions === positions) {
				if (sharedPositionOffset === 0) sharedPositionOffset = positionsOffset;
				assert.equal(positionsOffset, sharedPositionOffset, 'repeated primitive references share their position stream');
			}
			if (original.indices === undefined) {
				assert.equal(indicesOffset, 0);
				assert.equal(view.getUint32(offset + MODEL_PRIMITIVE.indexCount, true), 0);
				assert.equal(view.getUint32(offset + MODEL_PRIMITIVE.indexComponentType, true), 0);
				assert.equal(primitive.indices, undefined);
			} else {
				assert.notEqual(indicesOffset, 0);
				assert.equal(indicesOffset % 4, 0);
				assert.equal(view.getUint32(offset + MODEL_PRIMITIVE.indexCount, true), original.indices.length);
				assert.equal(view.getUint32(offset + MODEL_PRIMITIVE.indexComponentType, true), original.indexComponentType);
				assert.deepEqual(buffer.subarray(indicesOffset, indicesOffset + original.indices.byteLength),
					new Uint8Array(original.indices.buffer, original.indices.byteOffset, original.indices.byteLength));
				assert.equal(primitive.indices.buffer, buffer.buffer);
				assert.equal(primitive.indices.byteOffset, buffer.byteOffset + indicesOffset);
				assert.equal(primitive.indices.BYTES_PER_ELEMENT, original.indices.BYTES_PER_ELEMENT);
			}
			primitiveIndex += 1;
		}
	}
	const rich = decodeBinary(buffer.subarray(richOffset, richOffset + richLength), { zeroCopyBin: true });
	for (const mesh of rich.meshes) {
		for (const primitive of mesh.primitives) {
			assert.equal(Object.hasOwn(primitive, 'positions'), false, 'the rich graph does not duplicate position bytes');
			assert.equal(Object.hasOwn(primitive, 'indices'), false, 'the rich graph does not duplicate index bytes');
		}
	}
	assert.deepEqual(rich.nodes, model.nodes);
	for (let index = 0; index < model.nodes.length; index++) {
		for (const key of ['mesh', 'children', 'translation', 'rotation', 'scale', 'matrix', 'skin', 'weights', 'visible'] as const) {
			assert.deepEqual(loaded.nodes[index][key], model.nodes[index][key]);
		}
	}
	assert.deepEqual(loaded.scenes, model.scenes);
	assert.equal(loaded.scene, model.scene);
	assert.deepEqual(new Uint32Array(loaded.meshes[1].primitives[0].positions.buffer,
		loaded.meshes[1].primitives[0].positions.byteOffset, positions.length), positionWords);
});
