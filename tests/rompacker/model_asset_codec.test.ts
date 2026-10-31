import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GLTFModel, GLTFPrimitive } from '../../toolchain/ts/rompack/gltf';
import { loadModelFromBuffer, packModelAsset } from '../../toolchain/ts/rompack/model_asset';

for (const inputKind of ['uint8-subview', 'node-buffer', 'node-buffer-subview'] as const) {
	test(`model transport retains grouped geometry and complete typed attributes from ${inputKind}`, () => {
		const complete: GLTFPrimitive = {
			positions: new Float32Array([0.1, 0.2, 0.3, 1, 0, 0, 0, 1, 0]),
			texcoords: new Float32Array([0, 0, 1, 0, 0, 1]),
			texcoords1: new Float32Array([0.25, 0.75, 0.5, 0.75, 0.25, 0.5]),
			normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
			tangents: new Float32Array([1, 0, 0, -1, 1, 0, 0, 1, 1, 0, 0, -1]),
			indices: new Uint8Array([0, 1, 2, 2, 1, 0]),
			indexComponentType: 5121,
			materialIndex: 1,
			morphPositions: [new Float32Array(), new Float32Array([0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3])],
			morphNormals: [new Float32Array([0, 0.1, 0, 0, 0.2, 0, 0, 0.3, 0]), new Float32Array()],
			morphTangents: [new Float32Array([0, 0, 0.1, 0, 0, 0.2, 0, 0, 0.3]), new Float32Array()],
			jointIndices: new Uint16Array([0, 1, 2, 3, 3, 2, 1, 0, 0, 2, 1, 3]),
			jointWeights: new Float32Array([0.5, 0.25, 0.25, 0, 1, 0, 0, 0, 0.75, 0.125, 0.125, 0]),
			colors: new Float32Array([1, 0, 0, 0.5, 0, 1, 0, 0.75, 0, 0, 1, 1]),
		};
		const model: GLTFModel = {
			name: 'authored-name',
			meshes: [
				{
					name: 'two-material-mesh', weights: [0.25, 0.75],
					primitives: [complete, {
						positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
						indices: new Uint16Array([0, 1, 2, 2, 1, 0]), indexComponentType: 5123, materialIndex: 0,
					}],
				},
				{
					primitives: [{
						positions: new Float32Array([4, 0, 0, 5, 0, 0, 4, 1, 0]),
						// Transport preserves raw index words; it neither guesses width nor validates geometry.
						indices: new Uint32Array([0, 0x80000001, 0xffffffff]), indexComponentType: 5125,
					}],
				},
			],
			materials: [{}, {
				baseColorFactor: [0.25, 0.5, 0.75, 1], metallicFactor: 0.125, roughnessFactor: 0.625,
				baseColorTexture: 1, baseColorTexCoord: 1, normalTexture: 2, normalTexCoord: 0, normalScale: 0.75,
				metallicRoughnessTexture: 1, metallicRoughnessTexCoord: 0,
				occlusionTexture: 0, occlusionTexCoord: 1, occlusionStrength: 0.5,
				emissiveTexture: 2, emissiveTexCoord: 1, emissiveFactor: [0.125, 0.25, 0.5],
				alphaMode: 'MASK', alphaCutoff: 0.25, doubleSided: true, unlit: false,
			}],
			textures: [{ source: 1, sampler: 1 }, { source: 0, sampler: 0 }, { source: 0, sampler: 1 }, {}],
			samplers: [
				{ magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 33648 },
				{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 },
				{},
			],
			nodes: [
				{ mesh: 1, children: [1], matrix: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2.1, 3.2, 4.3, 1]) },
				{ mesh: 0, translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [2, 3, 4], skin: 0, weights: [0.75, 0.25], visible: false },
			],
			scenes: [{ nodes: [0] }, { nodes: [1] }], scene: 0,
			skins: [
				{
					joints: [0, 1], inverseBindMatrices: [
						new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2, -3, -4, 1]),
						new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1]),
					],
				},
				{ joints: [1] },
			],
			animations: [{
				name: 'move-and-morph', samplers: [
					{ interpolation: 'LINEAR', input: new Float32Array([0, 1]), output: new Float32Array([0, 0, 0, 1, 2, 3]) },
					{ interpolation: 'STEP', input: new Float32Array([0, 1]), output: new Float32Array([0.25, 0.75, 0.5, 0.5]) },
				],
				channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }, { sampler: 1, target: { node: 1, path: 'weights' } }],
			}],
		};
		const packed = packModelAsset(model);
		const allocation = inputKind === 'node-buffer'
			? Buffer.from(packed.buffer)
			: inputKind === 'node-buffer-subview'
				? Buffer.alloc(packed.buffer.length + 11, 0xa5)
				: new Uint8Array(packed.buffer.length + 11).fill(0xa5);
		const start = inputKind === 'node-buffer' ? 0 : 5;
		if (inputKind !== 'node-buffer') allocation.set(packed.buffer, start);
		const bytes = allocation.subarray(start, start + packed.buffer.length);
		if (inputKind === 'node-buffer-subview') assert.equal(bytes.byteOffset % 4, 1);
		const before = new Uint8Array(allocation);
		const decoded = loadModelFromBuffer('packed-asset-id', bytes);
		assert.equal(decoded.name, 'packed-asset-id');
		assert.deepEqual(decoded.meshes.map(mesh => mesh.primitives.length), [2, 1]);
		assert.equal(decoded.meshes[0].name, model.meshes[0].name);
		assert.deepEqual(decoded.meshes[0].weights, model.meshes[0].weights);
		assert.deepEqual(decoded.meshes[0].primitives[0], complete);
		for (let meshIndex = 0; meshIndex < model.meshes.length; meshIndex++) {
			for (let primitiveIndex = 0; primitiveIndex < model.meshes[meshIndex].primitives.length; primitiveIndex++) {
				const original = model.meshes[meshIndex].primitives[primitiveIndex];
				const loaded = decoded.meshes[meshIndex].primitives[primitiveIndex];
				assert.deepEqual(loaded.positions, original.positions);
				assert.deepEqual(loaded.indices, original.indices);
				assert.equal(loaded.indexComponentType, original.indexComponentType);
				assert.equal(loaded.materialIndex, original.materialIndex);
			}
		}
		assert.equal(decoded.nodes.length, model.nodes.length);
		for (let index = 0; index < model.nodes.length; index++) {
			for (const key of ['mesh', 'children', 'translation', 'rotation', 'scale', 'matrix', 'skin', 'weights', 'visible'] as const) {
				assert.deepEqual(decoded.nodes[index][key], model.nodes[index][key]);
			}
		}
		assert.equal(decoded.nodes[0].mesh, 1, 'node mesh indexes retain grouped mesh identity');
		assert.equal(decoded.nodes[1].mesh, 0);
		assert.deepEqual(decoded.scenes, model.scenes);
		assert.equal(decoded.scene, model.scene);
		assert.equal(decoded.skins.length, model.skins.length);
		for (let index = 0; index < model.skins.length; index++) {
			assert.deepEqual(decoded.skins[index].joints, model.skins[index].joints);
			assert.deepEqual(decoded.skins[index].inverseBindMatrices, model.skins[index].inverseBindMatrices);
		}
		assert.deepEqual(decoded.animations, model.animations);
		assert.deepEqual(decoded.materials, model.materials);
		assert.deepEqual(decoded.textures, model.textures);
		assert.deepEqual(decoded.samplers, model.samplers);
		assert.equal(decoded.materials[1].baseColorTexture, 1);
		assert.equal(decoded.materials[1].normalTexture, 2);
		assert.equal(decoded.materials[1].emissiveTexture, 2);
		assert.deepEqual(decoded.materials[1].emissiveFactor, [0.125, 0.25, 0.5]);
		assert.deepEqual(new Uint8Array(allocation), before, 'decoding never mutates packed asset bytes');
	});
}

for (const inputKind of ['uint8-subview', 'node-buffer-subview'] as const) {
	test(`model images retain exact slices and borrow the supplied ${inputKind} generation`, () => {
		const firstImage = new Uint8Array([0xa5, 1, 2, 3, 0xa5]).subarray(1, 4);
		const secondImage = new Uint8Array([0x5a, 4, 5, 0x5a]).subarray(1, 3);
		const model: GLTFModel = {
			name: 'images', meshes: [], imageURIs: ['first.png', 'second.png'], imageBuffers: [firstImage, secondImage],
			textures: [{ source: 1, sampler: 0 }, { source: 0, sampler: 1 }, { source: 0, sampler: 0 }],
			samplers: [{ wrapS: 33071 }, { wrapS: 10497 }],
		};
		const packed = packModelAsset(model);
		assert.deepEqual(packed.model_texture_buffer, new Uint8Array([1, 2, 3, 4, 5]));
		const metadataAllocation = inputKind === 'node-buffer-subview'
			? Buffer.alloc(packed.buffer.length + 9, 0x33)
			: new Uint8Array(packed.buffer.length + 9).fill(0x33);
		metadataAllocation.set(packed.buffer, 3);
		const imageAllocation = inputKind === 'node-buffer-subview'
			? Buffer.alloc(packed.model_texture_buffer.length + 11, 0x77)
			: new Uint8Array(packed.model_texture_buffer.length + 11).fill(0x77);
		imageAllocation.set(packed.model_texture_buffer, 5);
		const imageBytes = imageAllocation.subarray(5, 5 + packed.model_texture_buffer.length);
		const metadataBefore = new Uint8Array(metadataAllocation);
		const imageBefore = new Uint8Array(imageAllocation);
		const decoded = loadModelFromBuffer('images', metadataAllocation.subarray(3, 3 + packed.buffer.length), imageBytes);
		assert.equal(Object.hasOwn(decoded, 'imageOffsets'), false, 'transport image ranges are not published model state');
		assert.deepEqual(decoded.imageURIs, model.imageURIs);
		assert.deepEqual(decoded.imageBuffers.map(image => Array.from(image)), [[1, 2, 3], [4, 5]]);
		assert.equal(decoded.imageBuffers[0].buffer, imageAllocation.buffer);
		assert.equal(decoded.imageBuffers[0].byteOffset, imageBytes.byteOffset);
		assert.equal(decoded.imageBuffers[0].byteLength, firstImage.byteLength);
		assert.equal(decoded.imageBuffers[1].buffer, imageAllocation.buffer);
		assert.equal(decoded.imageBuffers[1].byteOffset, imageBytes.byteOffset + firstImage.byteLength);
		assert.equal(decoded.imageBuffers[1].byteLength, secondImage.byteLength);
		assert.deepEqual(decoded.textures, model.textures);
		assert.deepEqual(decoded.samplers, model.samplers);
		const otherGeneration = new Uint8Array([9, 8, 7, 6, 5]);
		const other = loadModelFromBuffer('images', packed.buffer, otherGeneration);
		assert.equal(other.imageBuffers[0].buffer, otherGeneration.buffer);
		assert.deepEqual(other.imageBuffers, [new Uint8Array([9, 8, 7]), new Uint8Array([6, 5])]);
		assert.deepEqual(decoded.imageBuffers.map(image => Array.from(image)), [[1, 2, 3], [4, 5]], 'later decoding retains the earlier generation');
		assert.deepEqual(new Uint8Array(metadataAllocation), metadataBefore);
		assert.deepEqual(new Uint8Array(imageAllocation), imageBefore);
	});
}

test('absent optional model data stays absent while an explicit zero-image table stays empty', () => {
	const model: GLTFModel = { name: 'minimal', meshes: [{ primitives: [{ positions: new Float32Array([0, 0, 0]) }] }] };
	const packed = packModelAsset(model);
	assert.equal(packed.model_texture_buffer, undefined);
	const decoded = loadModelFromBuffer('minimal', packed.buffer);
	for (const key of ['materials', 'animations', 'textures', 'samplers', 'imageURIs', 'imageBuffers', 'nodes', 'scenes', 'scene', 'skins'] as const) {
		assert.equal(decoded[key], undefined, `optional model member ${key} is not synthesized`);
	}
	assert.equal(decoded.meshes[0].name, undefined);
	assert.equal(decoded.meshes[0].weights, undefined);
	const primitive = decoded.meshes[0].primitives[0];
	assert.deepEqual(primitive.positions, model.meshes[0].primitives[0].positions);
	for (const key of ['texcoords', 'texcoords1', 'normals', 'tangents', 'indices', 'indexComponentType', 'materialIndex', 'morphPositions', 'morphNormals', 'morphTangents', 'jointIndices', 'jointWeights', 'colors'] as const) {
		assert.equal(primitive[key], undefined, `optional primitive member ${key} is not synthesized`);
	}
	const emptyImages = packModelAsset({ name: 'zero-images', meshes: [], textures: [], samplers: [], imageBuffers: [] });
	assert.deepEqual(emptyImages.model_texture_buffer, new Uint8Array());
	const emptyDecoded = loadModelFromBuffer('zero-images', emptyImages.buffer, emptyImages.model_texture_buffer);
	assert.deepEqual(emptyDecoded.meshes, []);
	assert.deepEqual(emptyDecoded.textures, []);
	assert.deepEqual(emptyDecoded.samplers, []);
	assert.equal(Object.hasOwn(emptyDecoded, 'imageOffsets'), false);
	assert.deepEqual(emptyDecoded.imageBuffers, []);
});
