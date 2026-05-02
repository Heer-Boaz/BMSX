export function packedLow16(word: number): number {
	return word & 0xffff;
}

export function packedHigh16(word: number): number {
	return (word >>> 16) & 0xffff;
}

export function packLowHigh16(low: number, high: number): number {
	return ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
}
