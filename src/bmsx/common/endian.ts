export function readLE16(data: ArrayLike<number>, offset: number): number {
	return (data[offset] | (data[offset + 1] << 8)) >>> 0;
}

export function readLE32(data: ArrayLike<number>, offset: number): number {
	return (
		data[offset]
		| (data[offset + 1] << 8)
		| (data[offset + 2] << 16)
		| (data[offset + 3] << 24)
	) >>> 0;
}

export function writeLE16(data: Uint8Array, offset: number, value: number): void {
	data[offset] = value & 0xff;
	data[offset + 1] = (value >>> 8) & 0xff;
}

export function writeLE32(data: Uint8Array, offset: number, value: number): void {
	data[offset] = value & 0xff;
	data[offset + 1] = (value >>> 8) & 0xff;
	data[offset + 2] = (value >>> 16) & 0xff;
	data[offset + 3] = (value >>> 24) & 0xff;
}
