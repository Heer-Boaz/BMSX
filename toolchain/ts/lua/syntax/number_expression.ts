import { LuaBinaryOperator, LuaSyntaxKind, LuaUnaryOperator, type LuaExpression, type LuaNumericLiteralExpression } from './ast';

/** The actual numeric token behind a literal, optionally under unary negation. */
export function luaNumericLiteral(expression: LuaExpression): LuaNumericLiteralExpression | null {
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression) return expression;
	if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Negate
		&& expression.operand.kind === LuaSyntaxKind.NumericLiteralExpression) return expression.operand;
	return null;
}

/** Literal syntax only; human scalar entry does not admit arithmetic. */
export function readLuaNumberLiteral(expression: LuaExpression): number | null {
	const literal = luaNumericLiteral(expression);
	return literal === null ? null : expression.kind === LuaSyntaxKind.UnaryExpression ? -literal.value : literal.value;
}

/** Read the closed Number-source format below, not arbitrary Lua expressions. */
export function readLuaNumberExpression(expression: LuaExpression): number | null {
	const literal = readLuaNumberLiteral(expression);
	if (literal !== null) return literal;
	if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Negate) {
		const operand = readLuaNumberExpression(expression.operand);
		return operand === null ? null : -operand;
	}
	if (expression.kind === LuaSyntaxKind.BinaryExpression && expression.operator === LuaBinaryOperator.Divide) {
		const numerator = readLuaNumberLiteral(expression.left), denominator = readLuaNumberLiteral(expression.right);
		if (denominator === 0 && (numerator === 0 || numerator === 1 || numerator === -1)) return numerator / denominator;
	}
	return null;
}

/** A self-contained Lua expression for every Number, without ambient globals.
 * Non-finite values have no numeric token spelling; arithmetic preserves their
 * runtime representation. Ordinary finite values retain round-trip precision. */
export function formatLuaNumberExpression(value: number): string {
	if (value !== value) return '(0 / 0)';
	if (value === Infinity) return '(1 / 0)';
	if (value === -Infinity) return '(-1 / 0)';
	return Object.is(value, -0) ? '-0' : String(value);
}
