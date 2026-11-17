import { f32BitsToNumber, numberToF32Bits } from '../../../machine/ts/common/float32';
import { formatFloat, formatInteger } from '../../../machine/ts/common/number_format';
import { parseDecimalFloat32Bits, parseHexFloat32Bits } from '../../../machine/ts/common/parse_float32';
import {
	luaFloatResultBits, luaFloatToInteger, luaIntegerFloorDivide, luaIntegerModulo,
	luaFloatFloorDivideBits, luaFloatModuloBits, luaShiftLeft, luaShiftRight
} from '../../../machine/ts/spec/blua32/numeric';
import { luaPow } from '../../../machine/ts/spec/blua32/pow';
import { LuaBinaryOperator, LuaUnaryOperator } from './syntax/ast';

/** Compile-time Numbers retain their subtype and raw payload, including NaN signs. */
export type NumberConstant = { readonly kind: 'integer' | 'float'; readonly word: number };
export function integerConstant(value: number): NumberConstant { return { kind: 'integer', word: value >>> 0 }; }
/** Exact map identity; numerically equal Integer/Float constants remain distinct. */
export function numberConstantKey(value: NumberConstant): number { return value.word + (value.kind === 'float' ? 0x1_0000_0000 : 0); }
export function numberConstantValue(value: NumberConstant): number { return value.kind === 'integer' ? value.word | 0 : f32BitsToNumber(value.word); }
export function numberConstantText(value: NumberConstant): string { return value.kind === 'integer' ? formatInteger(value.word | 0) : formatFloat(f32BitsToNumber(value.word)); }
export function numberConstantInteger(value: NumberConstant): number | null { return value.kind === 'integer' ? value.word | 0 : luaFloatToInteger(value.word); }

/** Lexing owns syntax admission. Null is the specified non-finite literal error. */
export function parseNumberConstant(text: string): NumberConstant | null {
	const hex = text.charAt(1) === 'x' || text.charAt(1) === 'X';
	const floating = hex ? /[.pP]/.test(text) : /[.eE]/.test(text);
	if (!floating) {
		let value = 0;
		if (hex) {
			for (let i = 2; i < text.length; ++i) value = (value * 16 + parseInt(text.charAt(i), 16)) >>> 0;
			return integerConstant(value);
		}
		for (let i = 0; i < text.length; ++i) {
			value = value * 10 + text.charCodeAt(i) - 48;
			if (value > 2147483647) break;
		}
		if (value <= 2147483647) return integerConstant(value);
	}
	const word = hex ? parseHexFloat32Bits(text) : parseDecimalFloat32Bits(text);
	return (word & 0x7fffffff) >= 0x7f800000 ? null : { kind: 'float', word };
}
export function evaluateNumberUnary(operator: LuaUnaryOperator, value: NumberConstant): NumberConstant | undefined {
	if (operator === LuaUnaryOperator.Negate) return value.kind === 'integer' ? integerConstant(-value.word) : { kind: 'float', word: (value.word ^ 0x80000000) >>> 0 };
	if (operator === LuaUnaryOperator.BitwiseNot) {
		const integer = numberConstantInteger(value);
		return integer === null ? undefined : integerConstant(~integer);
	}
	return undefined;
}
export function evaluateNumberBinary(operator: LuaBinaryOperator, left: NumberConstant, right: NumberConstant): NumberConstant | undefined {
	const integers = left.kind === 'integer' && right.kind === 'integer';
	if (operator === LuaBinaryOperator.BitwiseOr || operator === LuaBinaryOperator.BitwiseXor || operator === LuaBinaryOperator.BitwiseAnd
		|| operator === LuaBinaryOperator.ShiftLeft || operator === LuaBinaryOperator.ShiftRight) {
		const a = numberConstantInteger(left), b = numberConstantInteger(right);
		if (a === null || b === null) return undefined;
		switch (operator) {
			case LuaBinaryOperator.BitwiseOr: return integerConstant(a | b);
			case LuaBinaryOperator.BitwiseXor: return integerConstant(a ^ b);
			case LuaBinaryOperator.BitwiseAnd: return integerConstant(a & b);
			case LuaBinaryOperator.ShiftLeft: return integerConstant(luaShiftLeft(a, b));
			case LuaBinaryOperator.ShiftRight: return integerConstant(luaShiftRight(a, b));
		}
	}
	if (integers) {
		const a = left.word | 0, b = right.word | 0;
		switch (operator) {
			case LuaBinaryOperator.Add: return integerConstant(a + b);
			case LuaBinaryOperator.Subtract: return integerConstant(a - b);
			case LuaBinaryOperator.Multiply: return integerConstant(Math.imul(a, b));
			case LuaBinaryOperator.FloorDivide: return b === 0 ? undefined : integerConstant(luaIntegerFloorDivide(a, b));
			case LuaBinaryOperator.Modulus: return b === 0 ? undefined : integerConstant(luaIntegerModulo(a, b));
		}
	}
	if (operator === LuaBinaryOperator.FloorDivide || operator === LuaBinaryOperator.Modulus) {
		const a = left.kind === 'float' ? left.word : numberToF32Bits(left.word | 0);
		const b = right.kind === 'float' ? right.word : numberToF32Bits(right.word | 0);
		return { kind: 'float', word: operator === LuaBinaryOperator.FloorDivide ? luaFloatFloorDivideBits(a, b) : luaFloatModuloBits(a, b) };
	}
	const a = left.kind === 'integer' ? Math.fround(left.word | 0) : f32BitsToNumber(left.word);
	const b = right.kind === 'integer' ? Math.fround(right.word | 0) : f32BitsToNumber(right.word);
	let word: number;
	switch (operator) {
		case LuaBinaryOperator.Add: word = luaFloatResultBits(a + b); break;
		case LuaBinaryOperator.Subtract: word = luaFloatResultBits(a - b); break;
		case LuaBinaryOperator.Multiply: word = luaFloatResultBits(a * b); break;
		case LuaBinaryOperator.Divide: word = luaFloatResultBits(a / b); break;
		case LuaBinaryOperator.Exponent: word = luaFloatResultBits(luaPow(a, b)); break;
		default: return undefined;
	}
	return { kind: 'float', word };
}
