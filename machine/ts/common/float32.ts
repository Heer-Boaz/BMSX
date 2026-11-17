/** Binary32 word access. Shared scratch never escapes. */
const F32_BITS_VIEW = new DataView(new ArrayBuffer(4));

export function f32BitsToNumber(bits: number): number {
	F32_BITS_VIEW.setUint32(0, bits, true);
	return F32_BITS_VIEW.getFloat32(0, true);
}

export function numberToF32Bits(value: number): number {
	F32_BITS_VIEW.setFloat32(0, value, true);
	return F32_BITS_VIEW.getUint32(0, true);
}
