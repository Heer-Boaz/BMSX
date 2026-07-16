import {
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_VRAM_WIDTH,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_GPU_GP0_CPU_TO_VRAM_FIRST } from '../../machine/ts/machine/devices/gx/gpu';
import type { ImgMeta } from '../../machine/ts/rompack/format';

export const GX_SYSTEM_TEXTURE_ASSET_ID = 'gx_system_texture';
export const GX_SYSTEM_TEXTURE_X = GX_GPU_VRAM_WIDTH >> 1;
export const GX_SYSTEM_TEXTURE_Y = 0;
export const GX_SYSTEM_TEXTURE_WIDTH = 256;
export const GX_SYSTEM_TEXTURE_HEIGHT = 64;
const GX_PALETTE4_PIXELS_PER_WORD = 4;
export const GX_PALETTE4_CLUT_WORDS = 16;

export type GxTexture = {
	mode: typeof GX_GPU_TEXTURE_MODE_DIRECT16 | typeof GX_GPU_TEXTURE_MODE_PALETTE4;
	pixelWidth: number;
	wordWidth: number;
	height: number;
	payload: Buffer;
	clutOffset?: number;
};

export type GxDecodedImage = {
	rgba: Uint8Array;
	width: number;
	height: number;
};

function rgbaToDirect16(r: number, g: number, b: number, a: number): number {
	if (a === 0) {
		return 0;
	}
	return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10) | 0x8000;
}

function writeDirect16Pixels(
	stream: Buffer,
	offset: number,
	rgba: Uint8ClampedArray,
	sourceX: number,
	sourceY: number,
	sourceStride: number,
	width: number,
	height: number,
): number {
	let streamOffset = offset;
	let pendingWord = 0;
	let pendingHalf = 0;
	for (let row = 0; row < height; row += 1) {
		let pixelOffset = ((sourceY + row) * sourceStride + sourceX) << 2;
		for (let column = 0; column < width; column += 1) {
			const pixel = rgbaToDirect16(rgba[pixelOffset], rgba[pixelOffset + 1], rgba[pixelOffset + 2], rgba[pixelOffset + 3]);
			pixelOffset += 4;
			if (pendingHalf === 0) {
				pendingWord = pixel;
				pendingHalf = 1;
			} else {
				stream.writeUInt32LE((pendingWord | (pixel << 16)) >>> 0, streamOffset);
				streamOffset += 4;
				pendingHalf = 0;
			}
		}
	}
	if (pendingHalf !== 0) {
		stream.writeUInt32LE(pendingWord, streamOffset);
		streamOffset += 4;
	}
	return streamOffset;
}

export function buildDirect16GxTexture(width: number, height: number, rgba: Uint8ClampedArray): GxTexture {
	const payload = Buffer.alloc(((width * height + 1) >> 1) * 4);
	writeDirect16Pixels(payload, 0, rgba, 0, 0, width, width, height);
	return {
		mode: GX_GPU_TEXTURE_MODE_DIRECT16,
		pixelWidth: width,
		wordWidth: width,
		height,
		payload,
	};
}

function collectPalette4Indices(rgba: Uint8ClampedArray): { indices: Uint8Array; palette: number[] } {
	const pixelCount = rgba.length >> 2;
	const indices = new Uint8Array(pixelCount);
	const palette: number[] = [];
	const paletteIndexByWord = new Map<number, number>();
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const offset = pixel << 2;
		const word = rgbaToDirect16(rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]);
		let paletteIndex = paletteIndexByWord.get(word);
		if (paletteIndex === undefined) {
			if (palette.length === GX_PALETTE4_CLUT_WORDS) {
				throw new Error('[RomPacker] GX palette4 texture contains more than 16 RGB555/STP colors.');
			}
			paletteIndex = palette.length;
			palette.push(word);
			paletteIndexByWord.set(word, paletteIndex);
		}
		indices[pixel] = paletteIndex;
	}
	return { indices, palette };
}

export function buildPalette4GxTexture(width: number, height: number, rgba: Uint8ClampedArray): GxTexture {
	const palette4 = collectPalette4Indices(rgba);
	const wordWidth = (width + GX_PALETTE4_PIXELS_PER_WORD - 1) >> 2;
	const textureWordCount = wordWidth * height;
	const textureByteLength = ((textureWordCount + 1) >> 1) * 4;
	const payload = Buffer.alloc(textureByteLength + GX_PALETTE4_CLUT_WORDS * 2);
	let streamOffset = 0;
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
				payload.writeUInt32LE((pendingWord | (vramWord << 16)) >>> 0, streamOffset);
				streamOffset += 4;
				pendingHalf = 0;
			}
		}
	}
	if (pendingHalf !== 0) {
		payload.writeUInt32LE(pendingWord, streamOffset);
	}
	while (palette4.palette.length < GX_PALETTE4_CLUT_WORDS) {
		palette4.palette.push(0);
	}
	for (let index = 0; index < GX_PALETTE4_CLUT_WORDS; index += 2) {
		const low = palette4.palette[index];
		const high = palette4.palette[index + 1];
		payload.writeUInt32LE((low | (high << 16)) >>> 0, textureByteLength + index * 2);
	}
	return {
		mode: GX_GPU_TEXTURE_MODE_PALETTE4,
		pixelWidth: width,
		wordWidth,
		height,
		payload,
		clutOffset: textureByteLength,
	};
}

export function buildFixedDirect16Upload(texture: GxTexture, x: number, y: number): Buffer {
	const stream = Buffer.alloc(12 + texture.payload.length);
	stream.writeUInt32LE((GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24) >>> 0, 0);
	stream.writeUInt32LE((x | (y << 16)) >>> 0, 4);
	stream.writeUInt32LE((texture.wordWidth | (texture.height << 16)) >>> 0, 8);
	texture.payload.copy(stream, 12);
	return stream;
}

export function decodeGxTextureImage(rom: Uint8Array, textureStart: number, metadata: ImgMeta): GxDecodedImage {
	const width = metadata.width;
	const height = metadata.height;
	const textureU = metadata.texture_u;
	const textureV = metadata.texture_v;
	const textureWordWidth = metadata.gx_texture_word_width;
	const textureMode = metadata.gx_texture_mode;
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let word: number;
			if (textureMode === GX_GPU_TEXTURE_MODE_DIRECT16) {
				const sourceOffset = textureStart + (((textureV + y) * textureWordWidth + textureU + x) << 1);
				word = rom[sourceOffset]! | (rom[sourceOffset + 1]! << 8);
			} else if (textureMode === GX_GPU_TEXTURE_MODE_PALETTE4) {
				const sourceX = textureU + x;
				const sourceOffset = textureStart + (((textureV + y) * textureWordWidth + (sourceX >> 2)) << 1);
				const packed = rom[sourceOffset]! | (rom[sourceOffset + 1]! << 8);
				const paletteIndex = (packed >> ((sourceX & 3) << 2)) & 15;
				const paletteOffset = textureStart + metadata.gx_clut_offset! + (paletteIndex << 1);
				word = rom[paletteOffset]! | (rom[paletteOffset + 1]! << 8);
			} else {
				throw new Error(`Unsupported GX texture mode ${textureMode}.`);
			}
			const targetOffset = (y * width + x) << 2;
			const red = word & 31;
			const green = (word >> 5) & 31;
			const blue = (word >> 10) & 31;
			rgba[targetOffset] = (red << 3) | (red >> 2);
			rgba[targetOffset + 1] = (green << 3) | (green >> 2);
			rgba[targetOffset + 2] = (blue << 3) | (blue >> 2);
			rgba[targetOffset + 3] = word === 0 ? 0 : 255;
		}
	}
	return { rgba, width, height };
}
