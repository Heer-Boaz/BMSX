export function colorByte(value: number): number {
	if (value <= 0) {
		return 0;
	}
	if (value >= 1) {
		return 255;
	}
	return Math.round(value * 255);
}

export function blendPixel(target: Uint8Array, offset: number, r: number, g: number, b: number, a: number): void {
	if (a <= 0) {
		return;
	}
	if (a >= 255) {
		target[offset + 0] = r;
		target[offset + 1] = g;
		target[offset + 2] = b;
		target[offset + 3] = 255;
		return;
	}
	const inverse = 255 - a;
	target[offset + 0] = ((r * a) + (target[offset + 0] * inverse) + 127) / 255;
	target[offset + 1] = ((g * a) + (target[offset + 1] * inverse) + 127) / 255;
	target[offset + 2] = ((b * a) + (target[offset + 2] * inverse) + 127) / 255;
	target[offset + 3] = a + ((target[offset + 3] * inverse) + 127) / 255;
}
