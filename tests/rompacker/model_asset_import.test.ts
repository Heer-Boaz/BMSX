import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createLoadedProjectSourceCatalog } from '../../ide/runtime/sources';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import { prepareGLTFDocument, loadGLTFModel } from '../../scripts/rompacker/gltfloader';
import { generateRomAssets } from '../../scripts/rompacker/rombuilder';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { buildSystemToolingLayer } from '../../toolchain/ts/rompack/loader';
import { loadModelFromBuffer, packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import { createTestRuntimeRomPayload } from '../helpers/runtime_sources';

/** External glTF inputs, not a gameplay cart or a substituted model decoder.
 * Image bytes are opaque here; their codec is not this import/transport contract. */
function fixture() {
	const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
	const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), uv1 = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
	const indexValues = [0, 1, 2, 0, 2, 3], indices = [new Uint8Array(indexValues), new Uint16Array(indexValues), new Uint32Array(indexValues)];
	const morphNormals = new Float32Array(12), image = new Uint8Array([10, 20, 30]);
	const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
	const data = [positions, uv, uv1, ...indices, morphNormals, image, normals];
	const json = {
		asset: { version: '2.0' },
		extensionsUsed: ['KHR_materials_unlit'],
		buffers: data.map((value, index) => ({ uri: `${index}.bin`, byteLength: value.byteLength })),
		bufferViews: data.map((value, index) => ({ buffer: index, byteLength: value.byteLength })),
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
			{ bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
			{ bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
			...[5121, 5123, 5125].map((componentType, index) => ({ bufferView: index + 3, componentType, count: 6, type: 'SCALAR' })),
			{ bufferView: 6, componentType: 5126, count: 4, type: 'VEC3' },
			{ bufferView: 8, componentType: 5126, count: 4, type: 'VEC3' },
		],
		meshes: [
			{ name: 'two-materials', weights: [0.25], primitives: [
				{ attributes: { POSITION: 0, NORMAL: 7, TEXCOORD_0: 1, TEXCOORD_1: 2 }, indices: 3, material: 0, targets: [{ NORMAL: 6 }] },
				{ attributes: { POSITION: 0 }, indices: 4, material: 1 },
			] },
			{ name: 'other', primitives: [{ attributes: { POSITION: 0 }, indices: 5, material: 2 }] },
		],
		nodes: [{ mesh: 0, translation: [2, 3, 4], children: [1], weights: [0.75] },
			{ mesh: 1, matrix: [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] }, { mesh: 0 }],
		scenes: [{ nodes: [0, 2] }], scene: 0,
		materials: [
			{ pbrMetallicRoughness: { baseColorTexture: { index: 1, texCoord: 1 } }, normalTexture: { index: 0 } },
			{ emissiveTexture: { index: 0 }, emissiveFactor: [0.1, 0.2, 0.3] },
			{ extensions: { KHR_materials_unlit: {} } },
		],
		images: [{ uri: 'unused.png' }, { bufferView: 7, mimeType: 'image/png' }, { uri: 'used.png' }],
		textures: [{ source: 2, sampler: 1 }, { source: 2, sampler: 0 }, {}],
		samplers: [{ magFilter: 9728, wrapS: 33071, wrapT: 33071 }, { minFilter: 9729, wrapS: 10497, wrapT: 10497 }],
	};
	const path = resolve('model-fixture', 'scene.gltf'), files = new Map(data.map((value, index) =>
		[resolve('model-fixture', `${index}.bin`), new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]));
	files.set(resolve('model-fixture', 'unused.png'), new Uint8Array([1]));
	files.set(resolve('model-fixture', 'used.png'), new Uint8Array([40, 50]));
	const document = prepareGLTFDocument(Buffer.from(JSON.stringify(json)), path, file => files.get(file)!);
	return { document, positions, uv1, indices, image };
}

test('external mesh instances survive the real resource packer, package reader and source catalog', async t => {
	const f = fixture();
	const assets = await generateRomAssets([{ type: 'model', name: 'fixture', id: 0, sourcePath: 'scene.gltf', document: f.document }]);
	const prefix = layoutRomPrefix(assets, false, null), toc = encodeRomToc({ entries: prefix.entries, projectRootPath: 'model-fixture' });
	const header = { ...parseCartHeader(createTestRuntimeRomPayload()), tocOffset: prefix.nextOffset, tocLength: toc.length,
		dataOffset: CART_ROM_HEADER_SIZE, dataLength: prefix.payloadEnd - CART_ROM_HEADER_SIZE };
	const bytes = new Uint8Array(header.tocOffset + header.tocLength); writeCartRomHeader(bytes, header);
	for (const range of prefix.ranges) bytes.set(range.buffer, range.start);
	bytes.set(toc, header.tocOffset);
	const layer = await buildSystemToolingLayer({ bytes, header });
	const catalog = createLoadedProjectSourceCatalog({ admission: { id: 'models', projectRoot: 'model-fixture' }, layer }, []);
	t.after(() => catalog.dispose());
	const binding = catalog.resolveAsset('models', 'model', 'fixture')!;
	assert.equal(binding.contextId, 'models'); assert.ok(binding.value === layer.package.model.fixture);
	const model = binding.value;
	assert.equal(model.meshes.length, 2); assert.deepEqual(model.meshes.map(mesh => mesh.primitives.length), [2, 1]);
	const primitives = [model.meshes[0].primitives[0], model.meshes[0].primitives[1], model.meshes[1].primitives[0]];
	for (let index = 0; index < primitives.length; index++) {
		assert.deepEqual(primitives[index].positions, f.positions); assert.deepEqual(primitives[index].indices, f.indices[index]);
		assert.equal(primitives[index].materialIndex, index);
	}
	assert.deepEqual(primitives[0].texcoords1, f.uv1);
	assert.deepEqual(model.nodes!.map(node => node.mesh), [0, 1, 0]);
	assert.deepEqual(model.nodes![1].matrix, new Float64Array(f.document.json.nodes[1].matrix));
	assert.deepEqual(model.meshes[0].weights, [0.25]); assert.deepEqual(model.nodes![0].weights, [0.75]);
	assert.equal(primitives[0].morphPositions![0].length, 0, 'an omitted morph POSITION is the declared zero delta, not missing base geometry');
	assert.equal(model.materials![0].baseColorTexture, 1); assert.equal(model.materials![0].normalTexture, 0);
	assert.deepEqual(model.materials![1].emissiveFactor, [0.1, 0.2, 0.3]);
	assert.deepEqual(model.textures!.slice(0, 2), [{ source: 2, sampler: 1 }, { source: 2, sampler: 0 }]);
	assert.equal(model.textures![2].source, undefined); assert.equal(model.textures![2].sampler, undefined);
	assert.deepEqual(model.samplers, f.document.json.samplers);
	assert.deepEqual(model.imageBuffers, [new Uint8Array([1]), f.image, new Uint8Array([40, 50])]);
	for (const image of model.imageBuffers!) assert.ok(image.buffer === bytes.buffer, 'images borrow this exact immutable packed generation');
	assert.equal(model.imageBuffers![1].byteOffset, prefix.entries[0].model_texture_start! + 1);
});

test('accessors cannot read beyond their declared external buffer view into another payload', () => {
	const f = fixture(); f.document.json.bufferViews[0].byteLength -= 4;
	assert.throws(() => loadGLTFModel(f.document, 'short-view'));
});

for (const count of [0, 4.5]) test(`external accessor count ${count} cannot publish incomplete XYZ data`, () => {
	const f = fixture();
	f.document.json.meshes = [{ primitives: [{ attributes: { POSITION: 0 }, ...(count === 0 ? {} : { indices: 3 }) }] }];
	f.document.json.nodes = [{ mesh: 0 }]; f.document.json.scenes = [{ nodes: [0] }];
	f.document.json.accessors[0].count = count;
	// Padding makes the byte span valid: only the invalid declared element count must reject this input.
	f.document.json.bufferViews[0].byteLength = 64; f.document.json.buffers[0].byteLength = 64;
	const external = new Map(f.document.external); external.set('0.bin', new Uint8Array(64));
	assert.throws(() => loadGLTFModel({ ...f.document, external }, 'invalid-count'));
});

test('external images retain their slots or reject missing data, never compact source indexes', () => {
	const f = fixture(); f.document.json.images[0] = {};
	assert.throws(() => loadGLTFModel(f.document, 'missing-image'));
});

for (const [contract, mutate] of [
	['vertex attribute counts', (f: ReturnType<typeof fixture>) => { f.document.json.accessors[2].count = 3; }],
	['tangent dimensions', (f: ReturnType<typeof fixture>) => { f.document.json.meshes[0].primitives[0].attributes.TANGENT = 6; }],
	['triangle-list index count', (f: ReturnType<typeof fixture>) => { f.document.json.accessors[3].count = 5; }],
	['index vertex range', (f: ReturnType<typeof fixture>) => { f.document.external.get('3.bin')![0] = 4; }],
	['primitive material reference', (f: ReturnType<typeof fixture>) => { f.document.json.meshes[0].primitives[0].material = 9; }],
	['node mesh reference', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[1].mesh = 9; }],
	['node complete affine matrix', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[1].matrix = [1, 0, 0]; }],
	['node affine homogeneous row', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[1].matrix[15] = 0; }],
	['node TRS dimensions', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[0].translation = [1, 2]; }],
	['node exclusive placement representation', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[1].translation = [1, 2, 3]; }],
	['node child reference', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[0].children = [9]; }],
	['node forest parent ownership', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[2].children = [1]; }],
	['node forest cycle', (f: ReturnType<typeof fixture>) => { f.document.json.nodes[1].children = [0]; }],
	['scene root reference', (f: ReturnType<typeof fixture>) => { f.document.json.scenes[0].nodes = [9]; }],
	['scene root uniqueness', (f: ReturnType<typeof fixture>) => { f.document.json.scenes[0].nodes = [0, 0]; }],
	['scene root ownership', (f: ReturnType<typeof fixture>) => { f.document.json.scenes[0].nodes = [1]; }],
	['default scene reference', (f: ReturnType<typeof fixture>) => { f.document.json.scene = 3; }],
	['material texture reference', (f: ReturnType<typeof fixture>) => { f.document.json.materials[0].normalTexture.index = 9; }],
	['texture image reference', (f: ReturnType<typeof fixture>) => { f.document.json.textures[0].source = 9; }],
	['texture sampler reference', (f: ReturnType<typeof fixture>) => { f.document.json.textures[0].sampler = 9; }],
] as const) test(`external ${contract} are admitted before publishing model geometry`, () => {
	const f = fixture(); mutate(f); assert.throws(() => loadGLTFModel(f.document, 'invalid-input'));
});

test('a mesh-free glTF asset library retains its authored nodes', () => {
	const document = prepareGLTFDocument(Buffer.from('{"asset":{"version":"2.0"},"nodes":[{}]}'), resolve('library.gltf'), () => { throw new Error('No external data'); });
	const model = loadGLTFModel(document, 'library'); assert.equal(model.meshes.length, 0); assert.equal(model.nodes!.length, 1);
});

test('JSON matrix-authored placements retain the same Number precision as TRS placements', () => {
	const f = fixture();
	f.document.json.nodes[1].matrix[4] = 0.1;
	f.document.json.nodes[1].matrix[12] = 0.2;
	const imported = loadGLTFModel(f.document, 'number-matrix');
	assert.equal(imported.nodes[1].matrix[4], 0.1);
	assert.equal(imported.nodes[1].matrix[12], 0.2);
	const packed = packModelAsset(imported);
	const loaded = loadModelFromBuffer('number-matrix', packed.buffer, packed.model_texture_buffer);
	assert.equal(loaded.nodes[1].matrix[4], 0.1);
	assert.equal(loaded.nodes[1].matrix[12], 0.2);
});
