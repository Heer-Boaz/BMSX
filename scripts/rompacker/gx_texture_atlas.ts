import { HOST_SYSTEM_ATLAS_HEIGHT, HOST_SYSTEM_ATLAS_WIDTH } from '../../machine/ts/rompack/host_system_atlas';
import {
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_GPU_GP0_CPU_TO_VRAM_FIRST } from '../../machine/ts/machine/devices/gx/gpu';
import { BIOS_ATLAS_ID } from '../../machine/ts/rompack/format';
import { TEXTURE_ATLAS_RGBA_BYTES_PER_PIXEL } from './texture_atlas_contract';

const GX_GPU_VRAM_RIGHT_HALF_X = GX_GPU_VRAM_WIDTH >> 1;
const GX_SYSTEM_DIRECT16_BAND_WIDTH = 512;
const GX_DIRECT16_SLICE_WIDTH = 256;
const GX_DIRECT16_PAGE_HEIGHT = GX_GPU_VRAM_HEIGHT >> 1;
const GX_DIRECT16_CART_BASE_Y = GX_DIRECT16_PAGE_HEIGHT;
const GX_PALETTE4_PIXELS_PER_WORD = 4;
const GX_PALETTE4_CLUT_WORDS = 16;
const GX_PALETTE4_TEXTURE_Y = ((HOST_SYSTEM_ATLAS_WIDTH + GX_SYSTEM_DIRECT16_BAND_WIDTH - 1) >> 9) * HOST_SYSTEM_ATLAS_HEIGHT;

export const GX_PALETTE4_ATLAS_RGBA_BYTE_LIMIT =
	(GX_GPU_VRAM_WIDTH - GX_GPU_VRAM_RIGHT_HALF_X)
	* (GX_GPU_VRAM_HEIGHT - GX_PALETTE4_TEXTURE_Y - 1)
	* GX_PALETTE4_PIXELS_PER_WORD
	* TEXTURE_ATLAS_RGBA_BYTES_PER_PIXEL;

export type GxTextureAtlasBuildMode = 'palette4';

export type GxTextureAtlas =
	| {
		mode: typeof GX_GPU_TEXTURE_MODE_DIRECT16;
		stream: Buffer;
	}
	| {
		mode: typeof GX_GPU_TEXTURE_MODE_PALETTE4;
		x: number;
		y: number;
		clutX: number;
		clutY: number;
		stream: Buffer;
	};

function rgbaToDirect16(r: number, g: number, b: number, a: number): number {
	if (a === 0) {
		return 0;
	}
	return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10) | 0x8000;
}

function collectPalette4Indices(rgba: Uint8ClampedArray): { indices: Uint8Array; palette: number[] } | undefined {
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
				return undefined;
			}
			paletteIndex = palette.length;
			palette.push(word);
			paletteIndexByWord.set(word, paletteIndex);
		}
		indices[pixel] = paletteIndex;
	}
	return { indices, palette };
}

function writeGp0UploadHeader(stream: Buffer, offset: number, x: number, y: number, width: number, height: number): number {
	stream.writeUInt32LE((GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24) >>> 0, offset);
	stream.writeUInt32LE((x | (y << 16)) >>> 0, offset + 4);
	stream.writeUInt32LE((width | (height << 16)) >>> 0, offset + 8);
	return offset + 12;
}

function gp0UploadByteLength(width: number, height: number): number {
	return (3 + ((width * height + 1) >> 1)) * 4;
}

function writeDirect16Upload(
	stream: Buffer,
	offset: number,
	rgba: Uint8ClampedArray,
	sourceX: number,
	sourceY: number,
	sourceStride: number,
	targetX: number,
	targetY: number,
	width: number,
	height: number,
): number {
	let streamOffset = writeGp0UploadHeader(stream, offset, targetX, targetY, width, height);
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

export function buildDirect16GxTextureAtlas(atlasId: number, width: number, height: number, rgba: Uint8ClampedArray): GxTextureAtlas {
	let byteLength = 0;
	for (let sourceX = 0; sourceX < width; sourceX += GX_DIRECT16_SLICE_WIDTH) {
		const sliceWidth = width - sourceX < GX_DIRECT16_SLICE_WIDTH ? width - sourceX : GX_DIRECT16_SLICE_WIDTH;
		if (atlasId === BIOS_ATLAS_ID) {
			byteLength += gp0UploadByteLength(sliceWidth, height);
		} else {
			const firstHeight = height < GX_DIRECT16_PAGE_HEIGHT ? height : GX_DIRECT16_PAGE_HEIGHT;
			byteLength += gp0UploadByteLength(sliceWidth, firstHeight);
			if (height > firstHeight) {
				byteLength += gp0UploadByteLength(sliceWidth, height - firstHeight);
			}
		}
	}

	const stream = Buffer.alloc(byteLength);
	let streamOffset = 0;
	for (let sourceX = 0; sourceX < width; sourceX += GX_DIRECT16_SLICE_WIDTH) {
		const sliceWidth = width - sourceX < GX_DIRECT16_SLICE_WIDTH ? width - sourceX : GX_DIRECT16_SLICE_WIDTH;
		if (atlasId === BIOS_ATLAS_ID) {
			streamOffset = writeDirect16Upload(
				stream, streamOffset, rgba, sourceX, 0, width,
				GX_GPU_VRAM_RIGHT_HALF_X + (((sourceX >> 8) & 1) << 8),
				(sourceX >> 9) * height,
				sliceWidth, height,
			);
			continue;
		}
		const firstHeight = height < GX_DIRECT16_PAGE_HEIGHT ? height : GX_DIRECT16_PAGE_HEIGHT;
		streamOffset = writeDirect16Upload(
			stream, streamOffset, rgba, sourceX, 0, width,
			sourceX & (GX_GPU_VRAM_WIDTH - 1), GX_DIRECT16_CART_BASE_Y,
			sliceWidth, firstHeight,
		);
		if (height > firstHeight) {
			streamOffset = writeDirect16Upload(
				stream, streamOffset, rgba, sourceX, firstHeight, width,
				GX_GPU_VRAM_RIGHT_HALF_X + (((sourceX >> 8) & 1) << 8),
				GX_PALETTE4_TEXTURE_Y + ((sourceX >> 9) * (height - firstHeight)),
				sliceWidth, height - firstHeight,
			);
		}
	}
	return { mode: GX_GPU_TEXTURE_MODE_DIRECT16, stream };
}

export function buildPalette4GxTextureAtlas(atlasId: number, width: number, height: number, rgba: Uint8ClampedArray): GxTextureAtlas {
	const palette4 = collectPalette4Indices(rgba);
	if (palette4 === undefined) {
		throw new Error(`[RomPacker] GX palette4 atlas ${atlasId} contains more than 16 RGB555/STP colors.`);
	}

	const textureWordWidth = (width + GX_PALETTE4_PIXELS_PER_WORD - 1) >> 2;
	const textureX = GX_GPU_VRAM_RIGHT_HALF_X;
	const textureY = GX_PALETTE4_TEXTURE_Y;
	const clutX = textureX;
	const clutY = textureY + height;
	if (textureX + textureWordWidth > GX_GPU_VRAM_WIDTH || clutY >= GX_GPU_VRAM_HEIGHT) {
		throw new Error(`[RomPacker] GX palette4 atlas ${atlasId} does not fit the fixed cart texture region.`);
	}

	const textureVramWords = textureWordWidth * height;
	const texturePayloadWords = (textureVramWords + 1) >> 1;
	const clutPayloadWords = GX_PALETTE4_CLUT_WORDS >> 1;
	const stream = Buffer.alloc((3 + texturePayloadWords + 3 + clutPayloadWords) * 4);
	let streamOffset = writeGp0UploadHeader(stream, 0, textureX, textureY, textureWordWidth, height);
	let pendingWord = 0;
	let pendingHalf = 0;
	for (let y = 0; y < height; y += 1) {
		const rowPixel = y * width;
		for (let wordX = 0; wordX < textureWordWidth; wordX += 1) {
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
				stream.writeUInt32LE((pendingWord | (vramWord << 16)) >>> 0, streamOffset);
				streamOffset += 4;
				pendingHalf = 0;
			}
		}
	}
	if (pendingHalf !== 0) {
		stream.writeUInt32LE(pendingWord, streamOffset);
		streamOffset += 4;
	}

	while (palette4.palette.length < GX_PALETTE4_CLUT_WORDS) {
		palette4.palette.push(0);
	}
	streamOffset = writeGp0UploadHeader(stream, streamOffset, clutX, clutY, GX_PALETTE4_CLUT_WORDS, 1);
	for (let index = 0; index < GX_PALETTE4_CLUT_WORDS; index += 2) {
		const low = palette4.palette[index];
		const high = palette4.palette[index + 1];
		stream.writeUInt32LE((low | (high << 16)) >>> 0, streamOffset);
		streamOffset += 4;
	}

	return {
		mode: GX_GPU_TEXTURE_MODE_PALETTE4,
		x: textureX,
		y: textureY,
		clutX,
		clutY,
		stream,
	};
}
