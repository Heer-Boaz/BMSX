import { LuaSyntaxKind as SyntaxKind, type LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const forbiddenMathFloorPatternRule = defineLintRule('cart', 'forbidden_math_floor_pattern');

export function lintForbiddenMathFloorPattern(expression: Expression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (luaExpressionReferenceName(expression) !== 'math.floor') {
		return;
	}
	pushIssue(
		issues,
		forbiddenMathFloorPatternRule.name,
		expression,
		'math.floor is forbidden. Use // instead of floor-based rounding or truncation.',
	);
}

function luaExpressionReferenceName(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === SyntaxKind.MemberExpression) {
		const baseName = luaExpressionReferenceName(expression.base);
		if (!baseName) {
			return undefined;
		}
		return `${baseName}.${expression.identifier}`;
	}
	if (expression.kind === SyntaxKind.IndexExpression) {
		const baseName = luaExpressionReferenceName(expression.base);
		const keyName = luaExpressionKeyName(expression.index);
		if (!baseName || !keyName) {
			return undefined;
		}
		return `${baseName}.${keyName}`;
	}
	return undefined;
}

function luaExpressionKeyName(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	return undefined;
}
