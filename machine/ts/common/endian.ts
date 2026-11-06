export function readLE16(data: ArrayLike<number>, offset: number): number {
	return (data[offset] | (data[offset + 1] << 8)) >>> 0;
}

export function readI16LE(data: ArrayLike<number>, offset: number): number {
	const word = readLE16(data, offset);
	return (word & 0x8000) !== 0 ? word - 0x10000 : word;
}

export function readLE32(data: ArrayLike<number>, offset: number): number {
	return (
		data[offset]
		| (data[offset + 1] << 8)
		| (data[offset + 2] << 16)
		| (data[offset + 3] << 24)
	) >>> 0;
}

// Integer counters are exact JS numbers in the TS runtime. Split their words
// arithmetically rather than allocating BigInts at the binary I/O boundary.
export function readLE64(data: ArrayLike<number>, offset: number): number {
	return readLE32(data, offset + 4) * 0x100000000 + readLE32(data, offset);
}

export function readI64LE(data: ArrayLike<number>, offset: number): number {
	return (readLE32(data, offset + 4) | 0) * 0x100000000 + readLE32(data, offset);
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

export function writeLE64(data: Uint8Array, offset: number, value: number): void {
	const low = value >>> 0;
	writeLE32(data, offset, low);
	writeLE32(data, offset + 4, (value - low) / 0x100000000);
}

export function readLE32Array(data: Uint8Array): Uint32Array {
	const words = new Uint32Array(data.byteLength / 4);
	for (let index = 0; index < words.length; index += 1) {
		words[index] = readLE32(data, index * 4);
	}
	return words;
}

export function writeLE32Array(words: Uint32Array): Uint8Array {
	const data = new Uint8Array(words.length * 4);
	for (let index = 0; index < words.length; index += 1) {
		writeLE32(data, index * 4, words[index]);
	}
	return data;
}
