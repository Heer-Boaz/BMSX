export function decodeSignedQ16_16(value: number): number {
	return (value >> 16) + ((value & 0xffff) / 65536);
}

export function decodeSignedQ16_16WordsInto(target: Float32Array, targetBase: number, words: ArrayLike<number>, wordBase: number, count: number): void {
	for (let index = 0; index < count; index += 1) {
		target[targetBase + index] = decodeSignedQ16_16(words[wordBase + index] >>> 0);
	}
}

export function encodeSignedQ16_16(value: number): number {
	return Math.trunc(value * 65536) >>> 0;
}

export function decodeUnsignedQ16_16(value: number): number {
	return (value >>> 0) / 65536;
}

export function decodeTurn16(value: number): number {
	return (value & 0xffff) * ((Math.PI * 2) / 0x10000);
}
