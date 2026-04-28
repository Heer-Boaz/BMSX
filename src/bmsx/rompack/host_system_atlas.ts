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

function decodeBase64Bytes(base64: string): Uint8Array {
	if (typeof atob === 'function') {
		const binary = atob(base64);
		const out = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			out[index] = binary.charCodeAt(index);
		}
		return out;
	}
	const bufferCtor = (globalThis as unknown as { Buffer?: { from(value: string, encoding: 'base64'): Uint8Array } }).Buffer;
	if (bufferCtor) {
		return new Uint8Array(bufferCtor.from(base64, 'base64'));
	}
	throw new Error('[HostSystemAtlas] No base64 decoder is available.');
}

export function hostSystemAtlasPixels(): Uint8Array {
	if (cachedRgbaPixels === null) {
		cachedRgbaPixels = decodeBase64Bytes(HOST_SYSTEM_ATLAS_ARTIFACT.rgbaBase64);
		const expectedBytes = HOST_SYSTEM_ATLAS_WIDTH * HOST_SYSTEM_ATLAS_HEIGHT * 4;
		if (cachedRgbaPixels.byteLength !== expectedBytes) {
			throw new Error(`[HostSystemAtlas] Decoded atlas size ${cachedRgbaPixels.byteLength} does not match ${expectedBytes}.`);
		}
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
