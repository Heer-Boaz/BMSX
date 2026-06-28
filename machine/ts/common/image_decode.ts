import { Inflate } from 'pako';

export type DecodedImage = {
	width: number;
	height: number;
	pixels: Uint8Array;
};

const PNG_SIGNATURE_0 = 0x89504e47;
const PNG_SIGNATURE_1 = 0x0d0a1a0a;
const PNG_CHUNK_IHDR = 0x49484452;
const PNG_CHUNK_IDAT = 0x49444154;
const PNG_CHUNK_IEND = 0x49454e44;
const PNG_CHUNK_PLTE = 0x504c5445;
const PNG_CHUNK_TRNS = 0x74524e53;
const PNG_COLOR_GRAYSCALE = 0;
const PNG_COLOR_RGB = 2;
const PNG_COLOR_PALETTE = 3;
const PNG_COLOR_GRAYSCALE_ALPHA = 4;
const PNG_COLOR_RGBA = 6;
const PNG_BIT_DEPTH_U8 = 8;
const PNG_FILTER_BYTES_RGBA = 4;

function readU32be(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset]! << 24)
		| (bytes[offset + 1]! << 16)
		| (bytes[offset + 2]! << 8)
		| bytes[offset + 3]!
	) >>> 0;
}

function readU16be(bytes: Uint8Array, offset: number): number {
	return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function resolvePngSourceBytesPerPixel(colorType: number): number {
	switch (colorType) {
		case PNG_COLOR_GRAYSCALE:
		case PNG_COLOR_PALETTE:
			return 1;
		case PNG_COLOR_GRAYSCALE_ALPHA:
			return 2;
		case PNG_COLOR_RGB:
			return 3;
		case PNG_COLOR_RGBA:
			return 4;
	}
	throw new Error(`[decodePngToRgba] Unsupported PNG color type ${colorType}.`);
}

function expandPngPixelsToRgba(
	width: number,
	height: number,
	colorType: number,
	source: Uint8Array,
	palette: Uint8Array | null,
	transparency: Uint8Array | null,
): Uint8Array {
	const pixels = new Uint8Array(width * height * PNG_FILTER_BYTES_RGBA);
	let src = 0;
	let dst = 0;
	if (colorType === PNG_COLOR_RGBA) {
		pixels.set(source);
		return pixels;
	}
	if (colorType === PNG_COLOR_RGB) {
		const transparentRed = transparency && transparency.byteLength >= 6 ? readU16be(transparency, 0) : -1;
		const transparentGreen = transparency && transparency.byteLength >= 6 ? readU16be(transparency, 2) : -1;
		const transparentBlue = transparency && transparency.byteLength >= 6 ? readU16be(transparency, 4) : -1;
		for (let index = 0; index < width * height; index += 1) {
			const red = source[src]!;
			const green = source[src + 1]!;
			const blue = source[src + 2]!;
			pixels[dst] = red;
			pixels[dst + 1] = green;
			pixels[dst + 2] = blue;
			pixels[dst + 3] = red === transparentRed && green === transparentGreen && blue === transparentBlue ? 0 : 255;
			src += 3;
			dst += 4;
		}
		return pixels;
	}
	if (colorType === PNG_COLOR_PALETTE) {
		if (palette === null) {
			throw new Error('[decodePngToRgba] Palette PNG is missing PLTE.');
		}
		for (let index = 0; index < width * height; index += 1) {
			const paletteIndex = source[src]!;
			const paletteOffset = paletteIndex * 3;
			if (paletteOffset + 2 >= palette.byteLength) {
				throw new Error('[decodePngToRgba] Palette PNG references a missing PLTE entry.');
			}
			pixels[dst] = palette[paletteOffset]!;
			pixels[dst + 1] = palette[paletteOffset + 1]!;
			pixels[dst + 2] = palette[paletteOffset + 2]!;
			pixels[dst + 3] = transparency && paletteIndex < transparency.byteLength ? transparency[paletteIndex]! : 255;
			src += 1;
			dst += 4;
		}
		return pixels;
	}
	if (colorType === PNG_COLOR_GRAYSCALE) {
		const transparentGray = transparency && transparency.byteLength >= 2 ? readU16be(transparency, 0) : -1;
		for (let index = 0; index < width * height; index += 1) {
			const gray = source[src]!;
			pixels[dst] = gray;
			pixels[dst + 1] = gray;
			pixels[dst + 2] = gray;
			pixels[dst + 3] = gray === transparentGray ? 0 : 255;
			src += 1;
			dst += 4;
		}
		return pixels;
	}
	for (let index = 0; index < width * height; index += 1) {
		const gray = source[src]!;
		pixels[dst] = gray;
		pixels[dst + 1] = gray;
		pixels[dst + 2] = gray;
		pixels[dst + 3] = source[src + 1]!;
		src += 2;
		dst += 4;
	}
	return pixels;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
	const p = left + up - upLeft;
	const pa = p > left ? p - left : left - p;
	const pb = p > up ? p - up : up - p;
	const pc = p > upLeft ? p - upLeft : upLeft - p;
	if (pa <= pb && pa <= pc) {
		return left;
	}
	if (pb <= pc) {
		return up;
	}
	return upLeft;
}

function decodePngFilteredPixels(width: number, height: number, inflated: Uint8Array, filterBytesPerPixel: number, sourceBytesPerPixel: number): Uint8Array {
	const rowBytes = width * sourceBytesPerPixel;
	const sourceStride = rowBytes + 1;
	const expectedBytes = sourceStride * height;
	if (inflated.byteLength < expectedBytes) {
		throw new Error('[decodePngToRgba] PNG payload is shorter than the image dimensions.');
	}
	const pixels = new Uint8Array(rowBytes * height);
	let source = 0;
	let dst = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = inflated[source]!;
		source += 1;
		const rowStart = dst;
		for (let x = 0; x < rowBytes; x += 1) {
			const raw = inflated[source + x]!;
			const left = x >= filterBytesPerPixel ? pixels[dst - filterBytesPerPixel]! : 0;
			const up = y > 0 ? pixels[dst - rowBytes]! : 0;
			const upLeft = x >= filterBytesPerPixel && y > 0 ? pixels[dst - rowBytes - filterBytesPerPixel]! : 0;
			if (filter === 0) {
				pixels[dst] = raw;
			} else if (filter === 1) {
				pixels[dst] = (raw + left) & 0xff;
			} else if (filter === 2) {
				pixels[dst] = (raw + up) & 0xff;
			} else if (filter === 3) {
				pixels[dst] = (raw + ((left + up) >>> 1)) & 0xff;
			} else if (filter === 4) {
				pixels[dst] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
			} else {
				throw new Error(`[decodePngToRgba] Unsupported PNG filter ${filter}.`);
			}
			dst += 1;
		}
		source += rowBytes;
		dst = rowStart + rowBytes;
	}
	return pixels;
}

export function decodePngToRgba(buffer: Uint8Array): DecodedImage {
	if (buffer.byteLength < 33 || readU32be(buffer, 0) !== PNG_SIGNATURE_0 || readU32be(buffer, 4) !== PNG_SIGNATURE_1) {
		throw new Error('[decodePngToRgba] Invalid PNG signature.');
	}

	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let compression = 0;
	let filterMethod = 0;
	let interlace = 0;
	let palette: Uint8Array | null = null;
	let transparency: Uint8Array | null = null;
	const idatChunks: Uint8Array[] = [];
	let offset = 8;
	while (offset + 12 <= buffer.byteLength) {
		const length = readU32be(buffer, offset);
		const type = readU32be(buffer, offset + 4);
		const chunkStart = offset + 8;
		const chunkEnd = chunkStart + length;
		if (chunkEnd + 4 > buffer.byteLength) {
			throw new Error('[decodePngToRgba] PNG chunk exceeds buffer length.');
		}
		if (type === PNG_CHUNK_IHDR) {
			width = readU32be(buffer, chunkStart);
			height = readU32be(buffer, chunkStart + 4);
			bitDepth = buffer[chunkStart + 8]!;
			colorType = buffer[chunkStart + 9]!;
			compression = buffer[chunkStart + 10]!;
			filterMethod = buffer[chunkStart + 11]!;
			interlace = buffer[chunkStart + 12]!;
		} else if (type === PNG_CHUNK_PLTE) {
			palette = buffer.subarray(chunkStart, chunkEnd);
		} else if (type === PNG_CHUNK_TRNS) {
			transparency = buffer.subarray(chunkStart, chunkEnd);
		} else if (type === PNG_CHUNK_IDAT) {
			idatChunks.push(buffer.subarray(chunkStart, chunkEnd));
		} else if (type === PNG_CHUNK_IEND) {
			break;
		}
		offset = chunkEnd + 4;
	}
	if (width <= 0 || height <= 0) {
		throw new Error(`[decodePngToRgba] Invalid image size ${width}x${height}.`);
	}
	if (bitDepth !== PNG_BIT_DEPTH_U8 || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
		throw new Error(`[decodePngToRgba] Unsupported PNG format depth=${bitDepth} color=${colorType} compression=${compression} filter=${filterMethod} interlace=${interlace}.`);
	}
	const sourceBytesPerPixel = resolvePngSourceBytesPerPixel(colorType);
	if (idatChunks.length === 0) {
		throw new Error('[decodePngToRgba] PNG contains no image data.');
	}
	const inflator = new Inflate();
	for (let index = 0; index < idatChunks.length; index += 1) {
		inflator.push(idatChunks[index]!, index === idatChunks.length - 1);
		if (inflator.err) {
			throw new Error(`[decodePngToRgba] PNG inflate failed: ${inflator.msg}`);
		}
	}
	const inflated = inflator.result as Uint8Array;
	const source = decodePngFilteredPixels(width, height, inflated, sourceBytesPerPixel, sourceBytesPerPixel);
	return { width, height, pixels: expandPngPixelsToRgba(width, height, colorType, source, palette, transparency) };
}
