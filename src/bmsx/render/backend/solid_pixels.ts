import type { color_arr } from '../../rompack/format';

export function createSolidRgba8Pixels(width: number, height: number, rgba: color_arr): Uint8Array<ArrayBuffer> {
	const pixelCount = width * height;
	const data: Uint8Array<ArrayBuffer> = new Uint8Array(pixelCount * 4);
	const r = ~~(rgba[0] * 255);
	const g = ~~(rgba[1] * 255);
	const b = ~~(rgba[2] * 255);
	const a = ~~(rgba[3] * 255);
	for (let i = 0; i < pixelCount; i += 1) {
		const offset = i * 4;
		data[offset] = r;
		data[offset + 1] = g;
		data[offset + 2] = b;
		data[offset + 3] = a;
	}
	return data;
}
