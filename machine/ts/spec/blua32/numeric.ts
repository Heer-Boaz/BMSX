import { f32BitsToNumber, numberToF32Bits } from '../../common/float32';

export function luaFloorDivide(left: number, right: number): number {
	const quotient = left / right;
	const integer = Math.trunc(quotient);
	return integer > quotient ? integer - 1 : integer;
}

export function luaModulo(left: number, right: number): number {
	let remainder = left % right;
	if (remainder > 0 ? right < 0 : remainder < 0 && right > 0) {
		remainder += right;
	}
	return remainder;
}

// Integer divisors are admitted as nonzero by the instruction/folding owner.
export function luaIntegerFloorDivide(left: number, right: number): number {
	const quotient = Math.trunc(left / right), remainder = left % right;
	return (quotient - +(remainder !== 0 && ((remainder < 0) !== (right < 0)))) | 0;
}
export function luaIntegerModulo(left: number, right: number): number {
	const remainder = left % right;
	return (remainder !== 0 && ((remainder < 0) !== (right < 0)) ? remainder + right : remainder) | 0;
}
export function luaShiftLeft(value: number, count: number): number {
	if (count >= 32 || count <= -32) return 0;
	return count < 0 ? (value >>> -count) | 0 : value << count;
}
export function luaShiftRight(value: number, count: number): number {
	if (count >= 32 || count <= -32) return 0;
	return count < 0 ? value << -count : (value >>> count) | 0;
}
export const enum NumericOrder { Less = -1, Equal = 0, Greater = 1, Unordered = 2 }
export function luaCompareIntegerFloat(integer: number, value: number): NumericOrder {
	// JS represents every int32 and binary32 exactly. No fround on the Integer.
	return integer < value ? NumericOrder.Less : integer > value ? NumericOrder.Greater
		: integer === value ? NumericOrder.Equal : NumericOrder.Unordered;
}
export const BLUA32_FLOAT_NAN = 0x7fc00000;
export function luaFloatResultBits(value: number): number {
	const bits = numberToF32Bits(value);
	return (bits & 0x7fffffff) > 0x7f800000 ? BLUA32_FLOAT_NAN : bits;
}
export function luaFloatAddBits(left: number, right: number): number {
	return luaFloatResultBits(f32BitsToNumber(left) + f32BitsToNumber(right));
}
export function luaFloatSubtractBits(left: number, right: number): number {
	return luaFloatResultBits(f32BitsToNumber(left) - f32BitsToNumber(right));
}
export function luaFloatMultiplyBits(left: number, right: number): number {
	return luaFloatResultBits(f32BitsToNumber(left) * f32BitsToNumber(right));
}
export function luaFloatDivideBits(left: number, right: number): number {
	return luaFloatResultBits(f32BitsToNumber(left) / f32BitsToNumber(right));
}
export function luaFloatFloorDivideBits(left: number, right: number): number {
	const quotient = Math.fround(f32BitsToNumber(left) / f32BitsToNumber(right));
	const integer = Math.trunc(quotient);
	return luaFloatResultBits(integer > quotient ? integer - 1 : integer);
}
export function luaFloatModuloBits(left: number, right: number): number {
	const divisor = f32BitsToNumber(right);
	let remainder = Math.fround(f32BitsToNumber(left) % divisor);
	if (remainder > 0 ? divisor < 0 : remainder < 0 && divisor > 0) remainder += divisor;
	return luaFloatResultBits(remainder);
}
export function luaFloatNegateBits(bits: number): number { return (bits ^ 0x80000000) >>> 0; }

/** Null means INVALID_ARGUMENT at the consumer, not a zero-word conversion. */
export function luaFloatToWord(bits: number): number | null {
	const encodedExponent = (bits >>> 23) & 0xff;
	if (encodedExponent === 255) return null;
	const exponent = encodedExponent - 127;
	let magnitude = 0;
	if (exponent >= 0 && exponent < 55) {
		const significand = (bits & 0x7fffff) | 0x800000;
		magnitude = exponent < 23 ? significand >>> (23 - exponent) : significand << (exponent - 23);
	}
	return (bits >>> 31 ? -magnitude : magnitude) >>> 0;
}
export function luaFloatToInteger(bits: number): number | null {
	const value = f32BitsToNumber(bits);
	return value >= -2147483648 && value < 2147483648 && Math.trunc(value) === value ? value | 0 : null;
}
