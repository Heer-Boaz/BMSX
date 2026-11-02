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

/** A literal or the closed division encoding emitted for non-finite Numbers.
 * Outer negation can remain when a previously negative literal is rewritten. */
export function readLuaEncodedNumber(expression: LuaExpression): number | null {
	const literal = readLuaNumberLiteral(expression);
	if (literal !== null) return literal;
	let source = expression;
	while (source.kind === LuaSyntaxKind.UnaryExpression && source.operator === LuaUnaryOperator.Negate) source = source.operand;
	return source.kind === LuaSyntaxKind.BinaryExpression && source.operator === LuaBinaryOperator.Divide
		? readLuaNumberExpression(expression) : null;
}

/** A self-contained Lua expression for every Number, without ambient globals.
 * Non-finite values have no numeric token spelling; arithmetic preserves their
 * runtime representation. Ordinary finite values retain round-trip precision.
 * Ungrouped output is for standalone expressions such as table-field values. */
export function formatLuaNumberExpression(value: number, grouped = true): string {
	if (value !== value) return grouped ? '(0 / 0)' : '0/0';
	if (value === Infinity) return grouped ? '(1 / 0)' : '1/0';
	if (value === -Infinity) return grouped ? '(-1 / 0)' : '-1/0';
	return Object.is(value, -0) ? '-0' : String(value);
}
