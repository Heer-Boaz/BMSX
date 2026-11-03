import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ASSET_HEADER, MODEL_MATERIAL, MODEL_MATERIAL_BYTE_LENGTH, MODEL_PRIMITIVE, MODEL_PRIMITIVE_BYTE_LENGTH,
	MODEL_TEXTURE, MODEL_TEXTURE_BYTE_LENGTH } from '../../toolchain/ts/rompack/model_asset_layout';
import { decodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { MODEL_STATIC_FEATURE, prepareModelStaticScenes } from '../../toolchain/ts/rompack/model_static_scene';
import { createTexturedModelFixture } from '../helpers/textured_model';

test('imported base-color textures compile to shared native images, selected page UVs and flat modulation', async () => {
	const { imported, model, packed } = await createTexturedModelFixture();
	assert.deepEqual(model.imageBuffers, imported.imageBuffers.map(bytes => new Uint8Array(bytes)), 'authored image bytes survive separately from the native stream');
	assert.deepEqual(model.textureImages, imported.textureImages);
	assert.equal(model.textureImages[0], undefined, 'unused rich images do not consume native texture storage or decode work');
	assert.deepEqual(model.meshes[0].primitives[0].pageTexcoords, new Uint16Array([0x300, 0x303, 0x003, 0x000]), 'TEXCOORD_1, not the all-zero TEXCOORD_0');
	assert.deepEqual(model.meshes[1].primitives[0].pageTexcoords, model.meshes[0].primitives[0].pageTexcoords);
	assert.ok(model.meshes[1].primitives[0].pageTexcoords === model.meshes[0].primitives[0].pageTexcoords, 'shared streams retain identity for backend uploads');
	assert.ok(model.meshes[1].primitives[0].positions === model.meshes[0].primitives[0].positions);
	assert.equal(model.meshes[2].primitives[0].pageTexcoords, undefined);
	const prepared = prepareModelStaticScenes(model);
	assert.equal(prepared.scenes[0].features, MODEL_STATIC_FEATURE.texture);
	assert.deepEqual(prepared.materials.map(material => material.textureIndex), [1, 1, undefined]);
	assert.deepEqual(prepared.materials.map(material => material.command), [0x24808080, 0x24808040, 0x20664d33]);
	const view = new DataView(packed.buffer.buffer), materials = view.getUint32(MODEL_ASSET_HEADER.materialDirectoryOffset, true);
	assert.equal(view.getUint32(materials + MODEL_MATERIAL.textureIndex, true), 1);
	assert.equal(view.getUint32(materials + MODEL_MATERIAL_BYTE_LENGTH + MODEL_MATERIAL.textureIndex, true), 1);
	const textures = view.getUint32(MODEL_ASSET_HEADER.textureDirectoryOffset, true);
	assert.equal(view.getUint32(MODEL_ASSET_HEADER.textureCount, true), 2);
	const image = textures + MODEL_TEXTURE_BYTE_LENGTH, offset = view.getUint32(image + MODEL_TEXTURE.streamOffset, true);
	assert.equal(offset % 4, 0); assert.equal(view.getUint32(image + MODEL_TEXTURE.width, true), 4);
	assert.equal(view.getUint32(image + MODEL_TEXTURE.streamWordCount, true) * 4, model.textureImages[1].stream.length);
	const decoded = decodeImgDecStream(model.textureImages[1].stream, 0, model.textureImages[1].stream.length);
	const pixels = new DataView(decoded.payload.buffer, decoded.payload.byteOffset, decoded.payload.byteLength);
	assert.equal(pixels.getUint16(0, true), 0x801f, 'OPAQUE preserves red even where the PNG alpha is zero');
	assert.equal(pixels.getUint16(2, true), 0x83e0, 'source alpha is ignored, not blended into RGB');
	assert.equal(pixels.getUint16(6, true), 0x8000, 'opaque black must not become a transparent GPU texel');
	const primitives = view.getUint32(MODEL_ASSET_HEADER.primitiveDirectoryOffset, true);
	for (let index = 0; index < 2; index++) assert.equal(view.getUint32(primitives + index * MODEL_PRIMITIVE_BYTE_LENGTH + MODEL_PRIMITIVE.texcoordsOffset, true) % 4, 0);
});

test('unsupported static texture layouts remain rich assets rather than silently flattening or wrapping UVs', async () => {
	const { model } = await createTexturedModelFixture();
	const material = model.materials[0], primitive = model.meshes[0].primitives[0];
	const features = () => prepareModelStaticScenes(model).scenes[0].features;
	material.baseColorTexCoord = 2;
	assert.ok(features() & MODEL_STATIC_FEATURE.textureLayout);
	material.baseColorTexCoord = 1;
	primitive.texcoords1[0] = -0.25;
	assert.ok(features() & MODEL_STATIC_FEATURE.textureLayout);
	primitive.texcoords1[0] = 0;
	model.textureImages[1].width = 257;
	assert.ok(features() & MODEL_STATIC_FEATURE.textureLayout);
	model.textureImages[1].width = 4;
	material.alphaMode = 'BLEND';
	assert.equal(features(), MODEL_STATIC_FEATURE.texture | MODEL_STATIC_FEATURE.alpha);
});
