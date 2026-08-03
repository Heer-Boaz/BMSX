import { LuaBinaryOperator, LuaUnaryOperator } from '../syntax/ast';
import { luaFloorDivide, luaModulo } from '../../../../machine/ts/spec/blua32/numeric';
import type {
	ProgramLinkValueBinaryOperator,
	ProgramLinkValueExpression,
} from './program_object';

export function resolveCompileTimeNumberBinaryOperator(
	operator: LuaBinaryOperator,
): ProgramLinkValueBinaryOperator | undefined {
	switch (operator) {
		case LuaBinaryOperator.BitwiseOr:
		case LuaBinaryOperator.BitwiseXor:
		case LuaBinaryOperator.BitwiseAnd:
		case LuaBinaryOperator.ShiftLeft:
		case LuaBinaryOperator.ShiftRight:
		case LuaBinaryOperator.Add:
		case LuaBinaryOperator.Subtract:
		case LuaBinaryOperator.Multiply:
		case LuaBinaryOperator.Divide:
		case LuaBinaryOperator.FloorDivide:
		case LuaBinaryOperator.Modulus:
		case LuaBinaryOperator.Exponent:
			return operator;
		default:
			return;
	}
}

export function evaluateCompileTimeNumberBinaryOperator(operator: LuaBinaryOperator, left: number, right: number): number | undefined {
	switch (operator) {
		case LuaBinaryOperator.BitwiseOr:
			return left | right;
		case LuaBinaryOperator.BitwiseXor:
			return left ^ right;
		case LuaBinaryOperator.BitwiseAnd:
			return left & right;
		case LuaBinaryOperator.ShiftLeft:
			return left << (right & 31);
		case LuaBinaryOperator.ShiftRight:
			return left >> (right & 31);
		case LuaBinaryOperator.Add:
			return left + right;
		case LuaBinaryOperator.Subtract:
			return left - right;
		case LuaBinaryOperator.Multiply:
			return left * right;
		case LuaBinaryOperator.Divide:
			return left / right;
		case LuaBinaryOperator.FloorDivide:
			return luaFloorDivide(left, right);
		case LuaBinaryOperator.Modulus:
			return luaModulo(left, right);
		case LuaBinaryOperator.Exponent:
			return Math.pow(left, right);
	}
}

export function evaluateProgramLinkValueExpression(
	expression: ProgramLinkValueExpression,
	values?: ReadonlyMap<string, number>,
): number {
	switch (expression.kind) {
		case 'export':
			return values === undefined
				? expression.value
				: values.get(expression.exportPath)!;
		case 'number':
			return expression.value;
		case 'unary': {
			const operand = evaluateProgramLinkValueExpression(expression.operand, values);
			return expression.operator === LuaUnaryOperator.Negate
				? -operand
				: ~operand;
		}
		case 'binary':
			return evaluateCompileTimeNumberBinaryOperator(
				expression.operator,
				evaluateProgramLinkValueExpression(expression.left, values),
				evaluateProgramLinkValueExpression(expression.right, values),
			)!;
	}
}
