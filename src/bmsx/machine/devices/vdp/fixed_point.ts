export function decodeSignedQ16_16(value: number): number {
	return (value | 0) / 65536;
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
