import { PNG } from 'pngjs';

/** Presented RGBA pixels, with opaque output alpha, as in the visible host surface. */
export function encodeScreenshotPng(width: number, height: number, pixels: Uint8Array): Buffer {
	const png = new PNG({ width, height });
	png.data.set(pixels);
	for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 255;
	return PNG.sync.write(png);
}
