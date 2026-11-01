import { formatNumber } from '../../../../machine/ts/common/number_format';
import { utf8CodepointCount } from '../../../../machine/ts/common/utf8';
import { luaFloorDivide, luaModulo } from '../../../../machine/ts/spec/blua32/numeric';
import { luaPow } from '../../../../machine/ts/spec/blua32/pow';
import { LuaBinaryOperator, LuaUnaryOperator } from '../syntax/ast';

export type StaticScalar =
	| { readonly kind: 'nil' }
	| { readonly kind: 'boolean'; readonly value: boolean }
	| { readonly kind: 'number'; readonly value: number }
	| { readonly kind: 'string'; readonly value: string };

/** Symbol values retain their producer's tag and payload, not a guessed numeric value. */
export type StaticConstantValue = StaticScalar
	| { readonly kind: 'bss_addr' }
	| { readonly kind: 'data_addr' }
	| { readonly kind: 'rodata_addr' }
	| { readonly kind: 'link_value' };

export function isStaticFalsey(value: StaticConstantValue): boolean {
	return value.kind === 'nil' || value.kind === 'boolean' && !value.value;
}

export function evaluateStaticUnaryOperator(operator: LuaUnaryOperator, operand: StaticConstantValue): StaticScalar | undefined {
	switch (operator) {
		case LuaUnaryOperator.Negate:
			return operand.kind === 'number' ? { kind: 'number', value: -operand.value } : undefined;
		case LuaUnaryOperator.BitwiseNot:
			return operand.kind === 'number' ? { kind: 'number', value: ~operand.value } : undefined;
		case LuaUnaryOperator.Not:
			return { kind: 'boolean', value: isStaticFalsey(operand) };
		case LuaUnaryOperator.Length:
			return operand.kind === 'string' ? { kind: 'number', value: utf8CodepointCount(operand.value) } : undefined;
		case LuaUnaryOperator.StringId:
			return operand.kind === 'string' ? operand : undefined;
		default: return undefined;
	}
}

/** Short-circuit operators are evaluated by the expression traversal. */
export function evaluateStaticBinaryOperator(operator: LuaBinaryOperator, left: StaticConstantValue,
	right: StaticConstantValue): StaticScalar | undefined {
	if (operator === LuaBinaryOperator.Equal || operator === LuaBinaryOperator.NotEqual) {
		// Address and link-value tags do not describe their eventual scalar values.
		if (right.kind === 'bss_addr' || right.kind === 'data_addr' || right.kind === 'rodata_addr' || right.kind === 'link_value') {
			return undefined;
		}
		let equal: boolean;
		switch (left.kind) {
			case 'nil': equal = right.kind === 'nil'; break;
			case 'boolean': equal = right.kind === 'boolean' && left.value === right.value; break;
			case 'number': equal = right.kind === 'number' && left.value === right.value; break;
			case 'string': equal = right.kind === 'string' && left.value === right.value; break;
			default: return undefined;
		}
		return { kind: 'boolean', value: operator === LuaBinaryOperator.Equal ? equal : !equal };
	}
	if (operator === LuaBinaryOperator.Concat) {
		return (left.kind === 'number' || left.kind === 'string') && (right.kind === 'number' || right.kind === 'string')
			? {
				kind: 'string',
				value: (left.kind === 'number' ? formatNumber(left.value) : left.value)
					+ (right.kind === 'number' ? formatNumber(right.value) : right.value),
			} : undefined;
	}
	if (left.kind === 'number' && right.kind === 'number' || left.kind === 'string' && right.kind === 'string') {
		switch (operator) {
			case LuaBinaryOperator.LessThan: return { kind: 'boolean', value: left.value < right.value };
			case LuaBinaryOperator.LessEqual: return { kind: 'boolean', value: left.value <= right.value };
			case LuaBinaryOperator.GreaterThan: return { kind: 'boolean', value: left.value > right.value };
			case LuaBinaryOperator.GreaterEqual: return { kind: 'boolean', value: left.value >= right.value };
		}
	}
	if (left.kind !== 'number' || right.kind !== 'number') return undefined;
	const value = evaluateStaticNumberBinaryOperator(operator, left.value, right.value);
	return value === undefined ? undefined : { kind: 'number', value };
}

export function evaluateStaticNumberBinaryOperator(operator: LuaBinaryOperator, left: number, right: number): number | undefined {
	switch (operator) {
		case LuaBinaryOperator.BitwiseOr: return left | right;
		case LuaBinaryOperator.BitwiseXor: return left ^ right;
		case LuaBinaryOperator.BitwiseAnd: return left & right;
		case LuaBinaryOperator.ShiftLeft: return left << (right & 31);
		case LuaBinaryOperator.ShiftRight: return left >> (right & 31);
		case LuaBinaryOperator.Add: return left + right;
		case LuaBinaryOperator.Subtract: return left - right;
		case LuaBinaryOperator.Multiply: return left * right;
		case LuaBinaryOperator.Divide: return left / right;
		case LuaBinaryOperator.FloorDivide: return luaFloorDivide(left, right);
		case LuaBinaryOperator.Modulus: return luaModulo(left, right);
		case LuaBinaryOperator.Exponent: return luaPow(left, right);
	}
}
