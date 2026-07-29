export function writeSolidRgba8Pixels(pixels: Uint8Array, byteCount: number, argb: number): void {
	const r = (argb >>> 16) & 0xff;
	const g = (argb >>> 8) & 0xff;
	const b = argb & 0xff;
	const a = (argb >>> 24) & 0xff;
	for (let i = 0; i < byteCount; i += 4) {
		pixels[i + 0] = r;
		pixels[i + 1] = g;
		pixels[i + 2] = b;
		pixels[i + 3] = a;
	}
}

export function createSolidRgba8Pixels(width: number, height: number, argb: number): Uint8Array<ArrayBuffer> {
	const data: Uint8Array<ArrayBuffer> = new Uint8Array(width * height * 4);
	writeSolidRgba8Pixels(data, data.byteLength, argb);
	return data;
}
