const FIX16_SHIFT = 16n;
const FIX16_ONE = 1n << FIX16_SHIFT;
const I32_MIN = -0x8000_0000n;
const I32_MAX = 0x7fff_ffffn;
const I32_MIN_NUMBER = -0x8000_0000;
const I32_MAX_NUMBER = 0x7fff_ffff;
const F32_BITS_BUFFER = new ArrayBuffer(4);
const F32_BITS_VIEW = new DataView(F32_BITS_BUFFER);

export const FIX16_SCALE = 65536;

export function toSignedWord(value: number): number {
	return value | 0;
}

export function f32BitsToNumber(bits: number): number {
	F32_BITS_VIEW.setUint32(0, bits >>> 0, true);
	return F32_BITS_VIEW.getFloat32(0, true);
}

export function numberToF32Bits(value: number): number {
	F32_BITS_VIEW.setFloat32(0, value, true);
	return F32_BITS_VIEW.getUint32(0, true);
}

export function saturateI32(value: bigint): number {
	if (value < I32_MIN) {
		return I32_MIN_NUMBER;
	}
	if (value > I32_MAX) {
		return I32_MAX_NUMBER;
	}
	return Number(value);
}

export function saturateRoundedI32(value: number): number {
	if (!Number.isFinite(value)) {
		throw new Error('expected finite value');
	}
	const rounded = Math.round(value);
	if (rounded <= I32_MIN_NUMBER) {
		return I32_MIN_NUMBER;
	}
	if (rounded >= I32_MAX_NUMBER) {
		return I32_MAX_NUMBER;
	}
	return rounded | 0;
}

export function transformFixed16(m0: number, m1: number, tx: number, x: number, y: number): number {
	const accum = (BigInt(m0) * BigInt(x)) + (BigInt(m1) * BigInt(y)) + (BigInt(tx) * FIX16_ONE);
	return saturateI32(accum >> FIX16_SHIFT);
}
