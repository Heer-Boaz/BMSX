import { integerConstant, evaluateNumberBinary, evaluateNumberUnary, type NumberConstant } from '../number';
import { LuaBinaryOperator } from '../syntax/ast';
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
): NumberConstant {
	switch (expression.kind) {
		case 'export':
			return values === undefined
				? expression.value
				: integerConstant(values.get(expression.exportPath)!);
		case 'number':
			return expression.value;
	}
	const value = expression.kind === 'unary'
		? evaluateNumberUnary(expression.operator, evaluateProgramLinkValueExpression(expression.operand, values))
		: evaluateNumberBinary(expression.operator,
			evaluateProgramLinkValueExpression(expression.left, values),
			evaluateProgramLinkValueExpression(expression.right, values));
	if (value === undefined) throw new Error('Invalid numeric operation in a link-value expression.');
	return value;
}
