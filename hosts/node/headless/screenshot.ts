import { PNG } from 'pngjs';
import type { PngImageEncoder } from '../../common/image';

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
