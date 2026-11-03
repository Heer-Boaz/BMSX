import { createCanvas, loadImage } from 'canvas';
import { PNG } from 'pngjs';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';

/** Model images use the same native texture codec/upload path as atlas images.
 * Opaque materials ignore source alpha; black remains an opaque Direct16 word. */
export async function prepareModelTextures(model: GLTFModel): Promise<void> {
	if (model.imageBuffers === undefined) return;
	const usedImages = new Set<number>();
	if (model.materials !== undefined) for (const material of model.materials) if (material.baseColorTexture !== undefined)
		usedImages.add(model.textures[material.baseColorTexture].source);
	model.textureImages = await Promise.all(model.imageBuffers.map(async (bytes, index) => {
		if (!usedImages.has(index)) return undefined;
		const buffer = Buffer.from(bytes);
		let width: number, height: number, rgba: Uint8ClampedArray;
		if (buffer.readUInt32BE(0) === 0x89504e47) {
			// Canvas premultiplication discards RGB under zero alpha. OPAQUE
			// glTF materials use those RGB values, so decode PNG straight.
			const decoded = PNG.sync.read(buffer);
			({ width, height } = decoded);
			rgba = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
		} else {
			const image = await loadImage(buffer);
			({ width, height } = image);
			const context = createCanvas(width, height).getContext('2d');
			context.drawImage(image, 0, 0);
			rgba = context.getImageData(0, 0, width, height).data;
		}
		for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
		const texture = encodeDirect16GxTexture(width, height, rgba);
		return { width, height,
			stream: new Uint8Array(encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount)) };
	}));
}
