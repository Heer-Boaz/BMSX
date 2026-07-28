import {
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE4,
} from '../../spec/gx/gp0';
import { GX_GPU_CLUT_4BIT_WORDS } from '../../spec/gx/gp0';
const GX_PALETTE4_PIXELS_PER_WORD = 4;

export type GxTextureShape = {
	mode: number;
	wordWidth: number;
	height: number;
};

export type Direct16GxTexture = GxTextureShape & {
	mode: typeof GX_GPU_TEXTURE_MODE_DIRECT16;
	words: Buffer;
	textureWordCount: number;
	clutWordCount: 0;
};

export type Palette4GxTexture = GxTextureShape & {
	mode: typeof GX_GPU_TEXTURE_MODE_PALETTE4;
	words: Buffer;
	textureWordCount: number;
	clutWordCount: number;
};

export type NativeGxTexture = Direct16GxTexture | Palette4GxTexture;

export type GxDecodedImage = {
	rgba: Uint8Array;
	width: number;
	height: number;
};

export type GxTextureImageRegion = {
	width: number;
	height: number;
	textureU: number;
	textureV: number;
};

function rgbaToDirect16(r: number, g: number, b: number, a: number): number {
	if (a === 0) {
		return 0;
	}
	return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10) | 0x8000;
}

export function encodeDirect16GxTexture(
	width: number,
	height: number,
	rgba: Uint8ClampedArray,
): Direct16GxTexture {
	const words = Buffer.alloc(((width * height + 1) >> 1) << 2);
	let outputOffset = 0;
	let pendingWord = 0;
	let pendingHalf = 0;
	for (let pixelOffset = 0; pixelOffset < rgba.length; pixelOffset += 4) {
		const pixel = rgbaToDirect16(rgba[pixelOffset], rgba[pixelOffset + 1], rgba[pixelOffset + 2], rgba[pixelOffset + 3]);
		if (pendingHalf === 0) {
			pendingWord = pixel;
			pendingHalf = 1;
		} else {
			words.writeUInt32LE((pendingWord | (pixel << 16)) >>> 0, outputOffset);
			outputOffset += 4;
			pendingHalf = 0;
		}
	}
	if (pendingHalf !== 0) {
		words.writeUInt32LE(pendingWord, outputOffset);
	}
	return {
		mode: GX_GPU_TEXTURE_MODE_DIRECT16,
		wordWidth: width,
		height,
		words,
		textureWordCount: words.length >> 2,
		clutWordCount: 0,
	};
}

function collectPalette4Indices(rgba: Uint8ClampedArray): { indices: Uint8Array; palette: Uint16Array } {
	const pixelCount = rgba.length >> 2;
	const indices = new Uint8Array(pixelCount);
	const palette = new Uint16Array(GX_GPU_CLUT_4BIT_WORDS);
	const paletteIndexByWord = new Map<number, number>();
	let paletteLength = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const offset = pixel << 2;
		const word = rgbaToDirect16(rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]);
		let paletteIndex = paletteIndexByWord.get(word);
		if (paletteIndex === undefined) {
			if (paletteLength === GX_GPU_CLUT_4BIT_WORDS) {
				throw new Error('GX palette4 texture contains more than 16 RGB555/STP colors.');
			}
			paletteIndex = paletteLength;
			paletteLength += 1;
			palette[paletteIndex] = word;
			paletteIndexByWord.set(word, paletteIndex);
		}
		indices[pixel] = paletteIndex;
	}
	return { indices, palette };
}

export function encodePalette4GxTexture(
	width: number,
	height: number,
	rgba: Uint8ClampedArray,
): Palette4GxTexture {
	const palette4 = collectPalette4Indices(rgba);
	const wordWidth = (width + GX_PALETTE4_PIXELS_PER_WORD - 1) >> 2;
	const textureVramWordCount = wordWidth * height;
	const textureByteLength = ((textureVramWordCount + 1) >> 1) << 2;
	const words = Buffer.alloc(textureByteLength + GX_GPU_CLUT_4BIT_WORDS * 2);
	let outputOffset = 0;
	let pendingWord = 0;
	let pendingHalf = 0;
	for (let y = 0; y < height; y += 1) {
		const rowPixel = y * width;
		for (let wordX = 0; wordX < wordWidth; wordX += 1) {
			const sourceX = wordX << 2;
			let vramWord = 0;
			for (let nibble = 0; nibble < GX_PALETTE4_PIXELS_PER_WORD; nibble += 1) {
				const x = sourceX + nibble;
				if (x < width) {
					vramWord |= palette4.indices[rowPixel + x] << (nibble << 2);
				}
			}
			if (pendingHalf === 0) {
				pendingWord = vramWord;
				pendingHalf = 1;
			} else {
				words.writeUInt32LE((pendingWord | (vramWord << 16)) >>> 0, outputOffset);
				outputOffset += 4;
				pendingHalf = 0;
			}
		}
	}
	if (pendingHalf !== 0) {
		words.writeUInt32LE(pendingWord, outputOffset);
	}
	for (let index = 0; index < GX_GPU_CLUT_4BIT_WORDS; index += 2) {
		words.writeUInt32LE(
			(palette4.palette[index] | (palette4.palette[index + 1] << 16)) >>> 0,
			textureByteLength + index * 2,
		);
	}
	return {
		mode: GX_GPU_TEXTURE_MODE_PALETTE4,
		wordWidth,
		height,
		words,
		textureWordCount: textureByteLength >> 2,
		clutWordCount: GX_GPU_CLUT_4BIT_WORDS >> 1,
	};
}

export function decodeGxTextureImage(payload: Uint8Array, texture: GxTextureShape, image: GxTextureImageRegion): GxDecodedImage {
	const width = image.width;
	const height = image.height;
	const textureU = image.textureU;
	const textureV = image.textureV;
	const textureWordWidth = texture.wordWidth;
	const textureMode = texture.mode;
	if (textureMode !== GX_GPU_TEXTURE_MODE_DIRECT16 && textureMode !== GX_GPU_TEXTURE_MODE_PALETTE4) {
		throw new Error(`Unsupported GX texture mode ${textureMode}.`);
	}
	const direct16 = textureMode === GX_GPU_TEXTURE_MODE_DIRECT16;
	const paletteStart = (((textureWordWidth * texture.height) + 1) >> 1) << 2;
	const rgba = new Uint8Array(width * height * 4);
	let targetOffset = 0;
	for (let y = 0; y < height; y += 1) {
		const sourceRowOffset = (textureV + y) * textureWordWidth << 1;
		for (let x = 0; x < width; x += 1) {
			let sourceOffset: number;
			if (direct16) {
				sourceOffset = sourceRowOffset + ((textureU + x) << 1);
			} else {
				const sourceX = textureU + x;
				const packedOffset = sourceRowOffset + ((sourceX >> 2) << 1);
				const packed = payload[packedOffset]! | (payload[packedOffset + 1]! << 8);
				const paletteIndex = (packed >> ((sourceX & 3) << 2)) & 15;
				sourceOffset = paletteStart + (paletteIndex << 1);
			}
			const word = payload[sourceOffset]! | (payload[sourceOffset + 1]! << 8);
			const red = word & 31;
			const green = (word >> 5) & 31;
			const blue = (word >> 10) & 31;
			rgba[targetOffset] = (red << 3) | (red >> 2);
			rgba[targetOffset + 1] = (green << 3) | (green >> 2);
			rgba[targetOffset + 2] = (blue << 3) | (blue >> 2);
			rgba[targetOffset + 3] = word === 0 ? 0 : 255;
			targetOffset += 4;
		}
	}
	return { rgba, width, height };
}
