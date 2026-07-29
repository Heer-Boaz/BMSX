import { LuaSyntaxKind, type LuaBinaryOperator, type LuaExpression } from './ast';

export function isLuaEmptyStringLiteral(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.StringLiteralExpression && expression.value.length === 0;
}

export function isLuaNilLiteral(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.NilLiteralExpression;
}

export function stringLiteralValue(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	return undefined;
}

export function luaBinaryExpressionHasOperand(
	expression: LuaExpression,
	operator: LuaBinaryOperator,
	predicate: (expression: LuaExpression) => boolean,
): boolean {
	return expression.kind === LuaSyntaxKind.BinaryExpression
		&& expression.operator === operator
		&& (predicate(expression.left) || predicate(expression.right));
}
