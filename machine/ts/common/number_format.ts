import { numberToF32Bits } from './float32';

// Exact rational, counted-digit conversion (Dragon4 strategy), bounded for
// binary32 to five reusable 32-bit limbs. No per-format arrays or bignums.
// First binary32 word not less than each exact decimal power 10^-45..10^39.
const powers = new Uint32Array([0x00000001, 0x00000008, 0x00000048, 0x000002ca, 0x00001be1, 0x000116c3, 0x000ae398, 0x006ce3ef, 0x02081ceb, 0x03aa2425, 0x0554ad2e, 0x0704ec3d, 0x08a6274c, 0x0a4fb11f, 0x0c01ceb4, 0x0da24260, 0x0f4ad2f8, 0x10fd87b6, 0x129e74d2, 0x14461207, 0x15f79688, 0x179abe15, 0x19416d9b, 0x1af1c901, 0x1c971da1, 0x1e3ce509, 0x1fec1e4b, 0x219392ef, 0x233877ab, 0x24e69595, 0x26901d7d, 0x283424dd, 0x29e12e14, 0x2b8cbccd, 0x2d2fec00, 0x2edbe6ff, 0x30897060, 0x322bcc78, 0x33d6bf95, 0x358637be, 0x3727c5ad, 0x38d1b718, 0x3a83126f, 0x3c23d70b, 0x3dcccccd, 0x3f800000, 0x41200000, 0x42c80000, 0x447a0000, 0x461c4000, 0x47c35000, 0x49742400, 0x4b189680, 0x4cbebc20, 0x4e6e6b28, 0x501502f9, 0x51ba43b8, 0x5368d4a6, 0x551184e8, 0x56b5e621, 0x58635faa, 0x5a0e1bca, 0x5bb1a2bd, 0x5d5e0b6c, 0x5f0ac724, 0x60ad78ec, 0x6258d727, 0x64078679, 0x65a96817, 0x6753c21c, 0x69045952, 0x6aa56fa6, 0x6c4ecb90, 0x6e013f3a, 0x6fa18f08, 0x7149f2ca, 0x72fc6f7d, 0x749dc5ae, 0x7645371a, 0x77f684e0, 0x799a130c, 0x7b4097cf, 0x7cf0bdc3, 0x7e96769a, 0x7f800000]);
const numerator = new Uint32Array(5), denominator = new Uint32Array(5), shifted = new Uint32Array(5);
function multiplyFive(value: Uint32Array, count: number): void {
	for (let j = 0; j < count; ++j) {
		let carry = 0;
		for (let i = 0; i < 5; ++i) {
			const product = value[i] * 5 + carry;
			value[i] = product; carry = (product / 0x1_0000_0000) | 0;
		}
	}
}
function shiftLeft(value: Uint32Array, count: number): void {
	const words = count >>> 5, bits = count & 31;
	for (let i = 4; i >= 0; --i) {
		const source = i - words;
		let next = source >= 0 ? value[source] << bits : 0;
		if (bits !== 0 && source > 0) next |= value[source - 1] >>> (32 - bits);
		value[i] = next;
	}
}
function shiftRightOne(value: Uint32Array): void {
	for (let i = 0; i < 4; ++i) value[i] = (value[i] >>> 1) | (value[i + 1] << 31);
	value[4] >>>= 1;
}
function compare(left: Uint32Array, right: Uint32Array): number {
	for (let i = 4; i >= 0; --i) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
	return 0;
}
function subtract(left: Uint32Array, right: Uint32Array): void {
	let borrow = 0;
	for (let i = 0; i < 5; ++i) {
		const difference = left[i] - right[i] - borrow;
		left[i] = difference; borrow = +(difference < 0);
	}
}
function digits(magnitude: number, decimalExponent: number): number {
	const encodedExponent = magnitude >>> 23;
	const mantissa = (magnitude & 0x7fffff) | (encodedExponent === 0 ? 0 : 0x800000);
	const exponent = encodedExponent === 0 ? -149 : encodedExponent - 150;
	const scale = 6 - decimalExponent;
	numerator.fill(0); denominator.fill(0); numerator[0] = mantissa; denominator[0] = 1;
	if (scale >= 0) {
		multiplyFive(numerator, scale);
		const shift = -(exponent + scale), index = shift >>> 5, bit = shift & 31;
		let quotient = numerator[index] >>> bit;
		if (bit !== 0) quotient |= numerator[index + 1] << (32 - bit);
		if (shift !== 0) {
			const halfIndex = (shift - 1) >>> 5, halfBit = (shift - 1) & 31;
			const half = ((numerator[halfIndex] >>> halfBit) & 1) !== 0;
			let sticky = halfBit !== 0 && (numerator[halfIndex] & (0xffffffff >>> (32 - halfBit))) !== 0;
			for (let i = 0; i < halfIndex; ++i) sticky ||= numerator[i] !== 0;
			if (half && (sticky || (quotient & 1) !== 0)) ++quotient;
		}
		return quotient;
	}
	const power = -scale;
	multiplyFive(denominator, power);
	if (exponent >= power) shiftLeft(numerator, exponent - power); else shiftLeft(denominator, power - exponent);
	shifted.set(denominator); shiftLeft(shifted, 23);
	let quotient = 0;
	for (let bit = 23; bit >= 0; --bit) {
		if (compare(numerator, shifted) >= 0) { subtract(numerator, shifted); quotient |= 1 << bit; }
		shiftRightOne(shifted);
	}
	shiftLeft(numerator, 1);
	const half = compare(numerator, denominator);
	if (half > 0 || (half === 0 && (quotient & 1) !== 0)) ++quotient;
	return quotient;
}
export function formatInteger(value: number): string { return value.toString(); }
export function formatFloat(value: number): string {
	const bits = numberToF32Bits(value), magnitude = bits & 0x7fffffff;
	if (magnitude > 0x7f800000) return 'nan';
	if (magnitude === 0x7f800000) return bits >>> 31 ? '-inf' : 'inf';
	if (magnitude === 0) return bits >>> 31 ? '-0.0' : '0.0';
	const encodedExponent = magnitude >>> 23;
	const binaryExponent = encodedExponent === 0 ? 31 - Math.clz32(magnitude) - 149 : encodedExponent - 127;
	let decimalExponent = (binaryExponent * 78913) >> 18;
	if (magnitude >= powers[decimalExponent + 46]) ++decimalExponent;
	else if (magnitude < powers[decimalExponent + 45]) --decimalExponent;
	let significand = digits(magnitude, decimalExponent);
	if (significand === 10000000) { significand = 1000000; ++decimalExponent; }
	const text = significand.toString();
	let end = 7; while (end > 1 && text.charCodeAt(end - 1) === 48) --end;
	const sign = bits >>> 31 ? '-' : '';
	if (decimalExponent >= -4 && decimalExponent < 7) {
		const point = decimalExponent + 1;
		if (point > 0) return sign + text.slice(0, point) + (end > point ? '.' + text.slice(point, end) : '.0');
		return sign + '0.' + '0'.repeat(-point) + text.slice(0, end);
	}
	const exponent = decimalExponent < 0 ? -decimalExponent : decimalExponent;
	return sign + text[0] + (end > 1 ? '.' + text.slice(1, end) : '') + 'e' + (decimalExponent < 0 ? '-' : '+')
		+ String.fromCharCode(48 + ((exponent / 10) | 0), 48 + exponent % 10);
}
