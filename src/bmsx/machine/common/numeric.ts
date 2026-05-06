const FIX16_SHIFT = 16;
const I32_MIN_NUMBER = -0x8000_0000;
const I32_MAX_NUMBER = 0x7fff_ffff;
const I64_MIN_HI = 0x8000_0000 | 0;
const I64_MIN_LO = 0;
const I64_MAX_HI = 0x7fff_ffff;
const I64_MAX_LO = 0xffff_ffff;
const F32_BITS_BUFFER = new ArrayBuffer(4);
const F32_BITS_VIEW = new DataView(F32_BITS_BUFFER);

export const FIX16_SCALE = 65536;

export function toSignedWord(value: number): number {
	return value | 0;
}

export function nextPowerOfTwo(value: number): number {
	if (value <= 0) {
		return 0;
	}
	let power = 1;
	while (power < value) {
		power *= 2;
	}
	return power;
}

export function ceilLog2(value: number): number {
	let log = 0;
	let power = 1;
	while (power < value) {
		power *= 2;
		log += 1;
	}
	return log;
}

export function f32BitsToNumber(bits: number): number {
	F32_BITS_VIEW.setUint32(0, bits >>> 0, true);
	return F32_BITS_VIEW.getFloat32(0, true);
}

export function numberToF32Bits(value: number): number {
	F32_BITS_VIEW.setFloat32(0, value, true);
	return F32_BITS_VIEW.getUint32(0, true);
}

export function saturateRoundedI32(value: number): number {
	const rounded = Math.round(value);
	if (rounded <= I32_MIN_NUMBER) {
		return I32_MIN_NUMBER;
	}
	if (rounded >= I32_MAX_NUMBER) {
		return I32_MAX_NUMBER;
	}
	return rounded | 0;
}

function multiplyHighI32(lhs: number, rhs: number): number {
	const lhsLow = lhs & 0xffff;
	const lhsHigh = lhs >> 16;
	const rhsLow = rhs & 0xffff;
	const rhsHigh = rhs >> 16;
	const lowProduct = Math.imul(lhsLow, rhsLow);
	let middle = (lowProduct >>> 16) + Math.imul(lhsHigh, rhsLow);
	const highCarry = middle >> 16;
	middle = (middle & 0xffff) + Math.imul(lhsLow, rhsHigh);
	return (highCarry + (middle >> 16) + Math.imul(lhsHigh, rhsHigh)) | 0;
}

function signedAdd64Overflowed(lhsNegative: boolean, rhsNegative: boolean, sumHi: number): boolean {
	if (lhsNegative !== rhsNegative) {
		return false;
	}
	return (sumHi < 0) !== lhsNegative;
}

export function transformFixed16(m0: number, m1: number, tx: number, x: number, y: number): number {
	let accumHi = multiplyHighI32(m0, x);
	let accumLo = Math.imul(m0, x) >>> 0;
	let termHi = multiplyHighI32(m1, y);
	let termLo = Math.imul(m1, y) >>> 0;
	let sumLo = (accumLo + termLo) >>> 0;
	let carry = sumLo < accumLo ? 1 : 0;
	let sumHi = (accumHi + termHi + carry) | 0;
	let accumNegative = accumHi < 0;
	let termNegative = termHi < 0;
	if (signedAdd64Overflowed(accumNegative, termNegative, sumHi)) {
		accumHi = accumNegative ? I64_MIN_HI : I64_MAX_HI;
		accumLo = accumNegative ? I64_MIN_LO : I64_MAX_LO;
	} else {
		accumHi = sumHi;
		accumLo = sumLo;
	}

	termHi = tx >> FIX16_SHIFT;
	termLo = (tx << FIX16_SHIFT) >>> 0;
	sumLo = (accumLo + termLo) >>> 0;
	carry = sumLo < accumLo ? 1 : 0;
	sumHi = (accumHi + termHi + carry) | 0;
	accumNegative = accumHi < 0;
	termNegative = termHi < 0;
	if (signedAdd64Overflowed(accumNegative, termNegative, sumHi)) {
		accumHi = accumNegative ? I64_MIN_HI : I64_MAX_HI;
		accumLo = accumNegative ? I64_MIN_LO : I64_MAX_LO;
	} else {
		accumHi = sumHi;
		accumLo = sumLo;
	}

	const shiftedHi = accumHi >> FIX16_SHIFT;
	const shiftedLo = ((accumHi << FIX16_SHIFT) | (accumLo >>> FIX16_SHIFT)) >>> 0;
	if (shiftedHi > 0 || (shiftedHi === 0 && shiftedLo > I32_MAX_NUMBER)) {
		return I32_MAX_NUMBER;
	}
	if (shiftedHi < -1 || (shiftedHi === -1 && shiftedLo < 0x8000_0000)) {
		return I32_MIN_NUMBER;
	}
	return shiftedLo | 0;
}
