import { integerConstant, numberConstantValue, numberConstantText, evaluateNumberBinary, evaluateNumberUnary, type NumberConstant } from '../number';
import { utf8CodepointCount } from '../../../../machine/ts/common/utf8';
import { LuaBinaryOperator, LuaUnaryOperator } from '../syntax/ast';

export type StaticScalar =
	| { readonly kind: 'nil' }
	| { readonly kind: 'boolean'; readonly value: boolean }
	| { readonly kind: 'number'; readonly value: NumberConstant }
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
		case LuaUnaryOperator.BitwiseNot: {
			if (operand.kind !== 'number') return undefined;
			const value = evaluateNumberUnary(operator, operand.value);
			return value === undefined ? undefined : { kind: 'number', value };
		}
		case LuaUnaryOperator.Not:
			return { kind: 'boolean', value: isStaticFalsey(operand) };
		case LuaUnaryOperator.Length:
			return operand.kind === 'string' ? { kind: 'number', value: integerConstant(utf8CodepointCount(operand.value)) } : undefined;
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
			case 'number': equal = right.kind === 'number' && numberConstantValue(left.value) === numberConstantValue(right.value); break;
			case 'string': equal = right.kind === 'string' && left.value === right.value; break;
			default: return undefined;
		}
		return { kind: 'boolean', value: operator === LuaBinaryOperator.Equal ? equal : !equal };
	}
	if (operator === LuaBinaryOperator.Concat) {
		return (left.kind === 'number' || left.kind === 'string') && (right.kind === 'number' || right.kind === 'string')
			? {
				kind: 'string',
				value: (left.kind === 'number' ? numberConstantText(left.value) : left.value)
					+ (right.kind === 'number' ? numberConstantText(right.value) : right.value),
			} : undefined;
	}
	if (left.kind === 'number' && right.kind === 'number' || left.kind === 'string' && right.kind === 'string') {
		const a = left.kind === 'number' ? numberConstantValue(left.value) : left.value;
		const b = right.kind === 'number' ? numberConstantValue(right.value) : right.value;
		switch (operator) {
			case LuaBinaryOperator.LessThan: return { kind: 'boolean', value: a < b };
			case LuaBinaryOperator.LessEqual: return { kind: 'boolean', value: a <= b };
			case LuaBinaryOperator.GreaterThan: return { kind: 'boolean', value: a > b };
			case LuaBinaryOperator.GreaterEqual: return { kind: 'boolean', value: a >= b };
		}
	}
	if (left.kind !== 'number' || right.kind !== 'number') return undefined;
	const value = evaluateNumberBinary(operator, left.value, right.value);
	return value === undefined ? undefined : { kind: 'number', value };
}
