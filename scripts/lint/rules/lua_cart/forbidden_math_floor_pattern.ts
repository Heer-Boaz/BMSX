import { LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaExpression } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const forbiddenMathFloorPatternRule = defineLintRule('lua_cart', 'forbidden_math_floor_pattern');

export function lintForbiddenMathFloorPattern(expression: LuaExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
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

function luaExpressionReferenceName(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const baseName = luaExpressionReferenceName(expression.base);
		if (!baseName) {
			return undefined;
		}
		return `${baseName}.${expression.identifier}`;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const baseName = luaExpressionReferenceName(expression.base);
		const keyName = luaExpressionKeyName(expression.index);
		if (!baseName || !keyName) {
			return undefined;
		}
		return `${baseName}.${keyName}`;
	}
	return undefined;
}

function luaExpressionKeyName(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name;
	}
	return undefined;
}
