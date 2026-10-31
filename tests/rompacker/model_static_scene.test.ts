import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { packModelAsset, loadModelFromBuffer } from '../../toolchain/ts/rompack/model_asset';
import { MODEL_ASSET_HEADER, MODEL_MATERIAL, MODEL_MATERIAL_BYTE_LENGTH,
	MODEL_PART, MODEL_PART_BYTE_LENGTH, MODEL_SCENE, MODEL_SCENE_BYTE_LENGTH } from '../../toolchain/ts/rompack/model_asset_layout';
import { MODEL_STATIC_FEATURE } from '../../toolchain/ts/rompack/model_static_scene';

test('static scene descriptors retain node identity, shared meshes and complete Number affines', () => {
	const model: GLTFModel = {
		name: 'static', meshes: [{ primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), materialIndex: 0 }] }],
		materials: [{ baseColorFactor: [0.25, 0.5, 0.75, 1], doubleSided: true }],
		nodes: [
			{ translation: [0.1, 2, 3], scale: [2, 3, 4], children: [1] },
			{ mesh: 0, matrix: new Float64Array([1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, -1, 0, 5, 6, 7, 1]) },
			{ mesh: 0, translation: [-7, 8, 9], rotation: [0, 0, 1, 0] },
		],
		scenes: [{ nodes: [0, 2] }, { nodes: [] }], scene: 0,
	};
	const packed = packModelAsset(model);
	const view = new DataView(packed.buffer.buffer);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.defaultScene, true), 0);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.sceneCount, true), 2);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.partCount, true), 2);
	const scenes = view.getUint32(MODEL_ASSET_HEADER.sceneDirectoryOffset, true);
	assert.equal(view.getUint32(scenes + MODEL_SCENE.firstPart, true), 0);
	assert.equal(view.getUint32(scenes + MODEL_SCENE.partCount, true), 2);
	assert.equal(view.getUint32(scenes + MODEL_SCENE.features, true), 0);
	assert.equal(view.getUint32(scenes + MODEL_SCENE_BYTE_LENGTH + MODEL_SCENE.partCount, true), 0);
	const parts = view.getUint32(MODEL_ASSET_HEADER.partDirectoryOffset, true);
	for (let index = 0; index < 2; index++) {
		const offset = parts + index * MODEL_PART_BYTE_LENGTH;
		assert.equal(view.getUint32(offset + MODEL_PART.node, true), index + 1);
		assert.equal(view.getUint32(offset + MODEL_PART.mesh, true), 0);
	}
	const coefficients = Array.from({ length: 12 }, (_, index) => view.getFloat64(parts + MODEL_PART.affine + index * 8, true));
	assert.deepEqual(coefficients, [2, 0, 0, 1, 3, 0, 0, 0, -4, 10.1, 20, 31]);
	const rotated = Array.from({ length: 12 }, (_, index) => view.getFloat64(parts + MODEL_PART_BYTE_LENGTH + MODEL_PART.affine + index * 8, true));
	assert.deepEqual(rotated, [-1, 0, 0, 0, -1, 0, 0, 0, 1, -7, 8, 9]);
	const material = view.getUint32(MODEL_ASSET_HEADER.materialDirectoryOffset, true);
	assert.equal(view.getUint32(material + MODEL_MATERIAL.command, true), 0x20bf8040);
	assert.equal(view.getUint32(material + MODEL_MATERIAL.doubleSided, true), 1);
	assert.equal(MODEL_MATERIAL_BYTE_LENGTH, 8);
	const loaded = loadModelFromBuffer('static', packed.buffer);
	for (let index = 0; index < model.nodes.length; index++) {
		for (const [field, value] of Object.entries(model.nodes[index])) assert.deepEqual(loaded.nodes[index][field], value);
	}
});

test('rich assets still pack; capabilities belong to the selected static scene, not the whole asset', () => {
	const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const model: GLTFModel = { name: 'capabilities', meshes: [
		{ primitives: [{ positions, materialIndex: 1 }] },
		{ primitives: [{ positions, materialIndex: 0, colors: new Float32Array(12), morphPositions: [positions] }] },
	], materials: [{ baseColorTexture: 0, alphaMode: 'BLEND' },
		{ normalTexture: 0, metallicRoughnessTexture: 0, occlusionTexture: 0, emissiveTexture: 0, emissiveFactor: [1, 0, 0] }], textures: [{}],
		nodes: [{ mesh: 0 }, { mesh: 1, skin: 0 }], skins: [{ joints: [0] }],
		scenes: [{ nodes: [0] }, { nodes: [1] }],
	};
	const { buffer } = packModelAsset(model);
	const view = new DataView(buffer.buffer), scenes = view.getUint32(MODEL_ASSET_HEADER.sceneDirectoryOffset, true);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.defaultScene, true), 0xffffffff, 'no default scene is not inferred as mesh/scene zero');
	assert.equal(view.getUint32(scenes + MODEL_SCENE.features, true), 0);
	assert.equal(view.getUint32(scenes + MODEL_SCENE_BYTE_LENGTH + MODEL_SCENE.features, true),
		MODEL_STATIC_FEATURE.texture | MODEL_STATIC_FEATURE.alpha | MODEL_STATIC_FEATURE.vertexColor | MODEL_STATIC_FEATURE.morph | MODEL_STATIC_FEATURE.skin);
	const loaded = loadModelFromBuffer('capabilities', buffer);
	assert.equal(loaded.scene, undefined);
	assert.equal(loaded.materials[0].baseColorTexture, 0);
	assert.deepEqual(loaded.meshes[1].primitives[0].morphPositions[0], positions);
});
