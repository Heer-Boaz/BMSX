import { HOST_SYSTEM_ATLAS_ARTIFACT } from './host_system_atlas.generated';

export type HostSystemAtlasImage = {
	width: number;
	height: number;
	u: number;
	v: number;
	w: number;
	h: number;
};

export const HOST_SYSTEM_ATLAS_WIDTH = HOST_SYSTEM_ATLAS_ARTIFACT.width;
export const HOST_SYSTEM_ATLAS_HEIGHT = HOST_SYSTEM_ATLAS_ARTIFACT.height;

let cachedRgbaPixels: Uint8Array | null = null;

function createBase64DecodeTable(): Int16Array {
	const table = new Int16Array(128);
	table.fill(-1);
	for (let value = 0; value < 26; value += 1) {
		table[65 + value] = value;
		table[97 + value] = value + 26;
	}
	for (let value = 0; value < 10; value += 1) {
		table[48 + value] = value + 52;
	}
	table[43] = 62;
	table[47] = 63;
	return table;
}

const BASE64_DECODE_TABLE = createBase64DecodeTable();

function decodeBase64Bytes(base64: string, expectedBytes: number): Uint8Array {
	const out = new Uint8Array(expectedBytes);
	let outIndex = 0;
	let value = 0;
	let bits = -8;
	for (let index = 0; index < base64.length; index += 1) {
		const code = base64.charCodeAt(index);
		if (code === 61) {
			break;
		}
		if (code >= BASE64_DECODE_TABLE.length) {
			throw new Error('[HostSystemAtlas] Invalid base64 byte in generated atlas.');
		}
		const decoded = BASE64_DECODE_TABLE[code];
		if (decoded < 0) {
			throw new Error('[HostSystemAtlas] Invalid base64 byte in generated atlas.');
		}
		value = ((value << 6) | decoded) >>> 0;
		bits += 6;
		if (bits >= 0) {
			if (outIndex >= expectedBytes) {
				throw new Error('[HostSystemAtlas] Generated atlas pixel data is too large.');
			}
			out[outIndex] = (value >> bits) & 0xff;
			outIndex += 1;
			bits -= 8;
		}
	}
	if (outIndex !== expectedBytes) {
		throw new Error(`[HostSystemAtlas] Decoded atlas size ${outIndex} does not match ${expectedBytes}.`);
	}
	return out;
}

export function hostSystemAtlasPixels(): Uint8Array {
	if (cachedRgbaPixels === null) {
		const expectedBytes = HOST_SYSTEM_ATLAS_WIDTH * HOST_SYSTEM_ATLAS_HEIGHT * 4;
		cachedRgbaPixels = decodeBase64Bytes(HOST_SYSTEM_ATLAS_ARTIFACT.rgbaBase64, expectedBytes);
	}
	return cachedRgbaPixels;
}

export function hostSystemAtlasImage(id: string): HostSystemAtlasImage {
	const image = (HOST_SYSTEM_ATLAS_ARTIFACT.images as Record<string, HostSystemAtlasImage>)[id];
	if (image === undefined) {
		throw new Error(`[HostSystemAtlas] Image '${id}' is not in the host system atlas.`);
	}
	return image;
}
