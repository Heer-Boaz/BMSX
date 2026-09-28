import { PNG } from 'pngjs';
import type { ImageDecoder, PngImageEncoder } from '../../common/image';

export const encodePngImage: PngImageEncoder = async ({ width, height, pixels }) => {
	const png = new PNG({ width, height });
	png.data.set(pixels);
	return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
};

/** Presented RGBA pixels, with opaque output alpha, as in the visible host surface. */
export function encodeScreenshotPng(width: number, height: number, pixels: Uint8Array): Buffer {
	const png = new PNG({ width, height });
	png.data.set(pixels);
	for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 255;
	return PNG.sync.write(png);
}

/** Node's headless image surface uses PNG, as do its screenshot producers. */
export const decodeImage: ImageDecoder = async (url, maxWidth, maxHeight) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Image read failed (${response.status})`);
	const image = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
	const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
	const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
	if (width === image.width && height === image.height) return { width, height, pixels: image.data as Buffer<ArrayBuffer> };
	const pixels = new Uint8Array(width * height * 4);
	const stepX = image.width / width, stepY = image.height / height;
	for (let y = 0; y < height; y++) {
		const row = Math.trunc((y + 0.5) * stepY) * image.width;
		for (let x = 0; x < width; x++) {
			const source = (row + Math.trunc((x + 0.5) * stepX)) * 4, target = (y * width + x) * 4;
			pixels[target] = image.data[source]; pixels[target + 1] = image.data[source + 1];
			pixels[target + 2] = image.data[source + 2]; pixels[target + 3] = image.data[source + 3];
		}
	}
	return { width, height, pixels };
};
