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

function decodePngRgbaPixels(width: number, height: number, inflated: Uint8Array): Uint8Array {
	const rowBytes = width * PNG_FILTER_BYTES_RGBA;
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
			const left = x >= PNG_FILTER_BYTES_RGBA ? pixels[dst - PNG_FILTER_BYTES_RGBA]! : 0;
			const up = y > 0 ? pixels[dst - rowBytes]! : 0;
			const upLeft = x >= PNG_FILTER_BYTES_RGBA && y > 0 ? pixels[dst - rowBytes - PNG_FILTER_BYTES_RGBA]! : 0;
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

export async function decodePngToRgba(buffer: Uint8Array): Promise<DecodedImage> {
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
	if (bitDepth !== PNG_BIT_DEPTH_U8 || colorType !== PNG_COLOR_RGBA || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
		throw new Error(`[decodePngToRgba] Unsupported PNG format depth=${bitDepth} color=${colorType} compression=${compression} filter=${filterMethod} interlace=${interlace}.`);
	}
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
	return { width, height, pixels: decodePngRgbaPixels(width, height, inflated) };
}
