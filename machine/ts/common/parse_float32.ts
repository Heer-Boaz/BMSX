import { f32BitsToNumber, numberToF32Bits } from './float32';

/** A positive decimal token, already admitted by its lexical grammar. */
export function parseDecimalFloat32Bits(text: string): number {
	const approximate = Number(text), bits = numberToF32Bits(approximate);
	const rounded = f32BitsToNumber(bits);
	if (approximate === rounded) return bits;
	const lower = approximate < rounded ? bits - 1 : bits;
	const exponent = lower >>> 23;
	const significand = exponent === 0 ? lower : (lower & 0x7fffff) | 0x800000;
	const shift = exponent === 0 ? -150 : exponent - 151;
	const midpoint = (significand * 2 + 1) * 2 ** shift;
	if (approximate !== midpoint) return bits;
	// Only a binary64 result exactly at a binary32 midpoint can double-round.
	// Resolve that narrow case against the original decimal, not its double.
	const marker = text.search(/[eE]/), end = marker < 0 ? text.length : marker;
	const dot = text.indexOf('.');
	const digits = dot < 0 ? text.slice(0, end) : text.slice(0, dot) + text.slice(dot + 1, end);
	const decimalExponent = (marker < 0 ? 0 : Number(text.slice(marker + 1))) - (dot < 0 ? 0 : end - dot - 1);
	let numerator = BigInt(digits), denominator = 1n;
	if (decimalExponent >= 0) numerator *= 10n ** BigInt(decimalExponent);
	else denominator = 10n ** BigInt(-decimalExponent);
	let threshold = BigInt(significand * 2 + 1);
	if (shift >= 0) threshold <<= BigInt(shift);
	else numerator <<= BigInt(-shift);
	threshold *= denominator;
	return numerator < threshold ? lower : numerator > threshold ? lower + 1 : (lower & 1) === 0 ? lower : lower + 1;
}

/** A positive hexadecimal Float token. Round the significand once, to binary32. */
export function parseHexFloat32Bits(text: string): number {
	const marker = text.search(/[pP]/), end = marker < 0 ? text.length : marker;
	const dot = text.indexOf('.');
	const digits = dot < 0 ? text.slice(2, end) : text.slice(2, dot) + text.slice(dot + 1, end);
	const significand = BigInt('0x' + digits);
	if (significand === 0n) return 0;
	const scale = (marker < 0 ? 0 : Number(text.slice(marker + 1))) - (dot < 0 ? 0 : (end - dot - 1) * 4);
	const length = significand.toString(2).length;
	let exponent = length - 1 + scale;
	if (exponent > 127) return 0x7f800000;
	if (exponent < -150) return 0;
	const shift = Math.max(length - 24, -149 - scale);
	let rounded: bigint;
	if (shift <= 0) rounded = significand << BigInt(-shift);
	else {
		rounded = significand >> BigInt(shift);
		const remainder = significand - (rounded << BigInt(shift)), half = 1n << BigInt(shift - 1);
		if (remainder > half || remainder === half && (rounded & 1n) !== 0n) ++rounded;
	}
	if (exponent < -126) return Number(rounded);
	if (rounded === 0x1000000n) { rounded >>= 1n; ++exponent; }
	return exponent > 127 ? 0x7f800000 : ((exponent + 127) << 23) | (Number(rounded) & 0x7fffff);
}
