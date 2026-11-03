import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGLTFModel, prepareGLTFDocument } from '../../scripts/rompacker/gltfloader';
import { prepareModelTextures } from '../../scripts/rompacker/model_textures';
import { loadModelFromBuffer, packModelAsset } from '../../toolchain/ts/rompack/model_asset';

/** One explicit cart asset exercises external image/UV bindings and both consumers. */
export async function createTexturedModelFixture() {
	const path = resolve('carts/studio_test/res/studio_test_textured.gltf');
	const document = prepareGLTFDocument(readFileSync(path), path, readFileSync);
	const imported = loadGLTFModel(document, 'studio_test_textured');
	await prepareModelTextures(imported);
	const packed = packModelAsset(imported);
	const model = loadModelFromBuffer(imported.name, packed.buffer, packed.model_texture_buffer);
	return { document, imported, packed, model };
}
