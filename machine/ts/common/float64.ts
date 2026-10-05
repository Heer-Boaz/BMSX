/** Binary64 word access, independent of host byte order. Shared scratch never escapes. */
const bits = new DataView(new ArrayBuffer(8));

export function numberHighWord(value: number): number {
	bits.setFloat64(0, value, true);
	return bits.getInt32(4, true);
}

export function numberLowWord(value: number): number {
	bits.setFloat64(0, value, true);
	return bits.getUint32(0, true);
}

export function numberWithHighWord(value: number, high: number): number {
	bits.setFloat64(0, value, true);
	bits.setInt32(4, high, true);
	return bits.getFloat64(0, true);
}

export function numberWithLowWord(value: number, low: number): number {
	bits.setFloat64(0, value, true);
	bits.setUint32(0, low, true);
	return bits.getFloat64(0, true);
}
