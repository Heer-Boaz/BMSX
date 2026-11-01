import { LuaBinaryOperator, LuaUnaryOperator } from '../syntax/ast';
import { evaluateStaticNumberBinaryOperator } from '../static/scalar';
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
			return evaluateStaticNumberBinaryOperator(
				expression.operator,
				evaluateProgramLinkValueExpression(expression.left, values),
				evaluateProgramLinkValueExpression(expression.right, values),
			)!;
	}
}
