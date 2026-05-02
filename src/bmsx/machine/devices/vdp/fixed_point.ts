export function decodeSignedQ16_16(value: number): number {
	return (value | 0) / 65536;
}
