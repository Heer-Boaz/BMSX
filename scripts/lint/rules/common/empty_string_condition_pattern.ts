import { LuaBinaryOperator, LuaSyntaxKind, type LuaExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { isLuaEmptyStringLiteral } from '../../../../src/bmsx/lua/syntax/literals';
import { isCppEmptyStringToken } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { lintCppAdjacentEqualityComparison } from '../cpp/support/comparison';
import type { CppLintIssue } from '../cpp/support/diagnostics';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const emptyStringConditionPatternRule = defineLintRule('common', 'empty_string_condition_pattern');

export function lintLuaEmptyStringConditionPattern(expression: LuaExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (!matchesLuaEmptyStringConditionPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		emptyStringConditionPatternRule.name,
		expression,
		'Empty-string condition pattern is forbidden. Prefer truthy checks, and do not define empty strings as default/start/empty values.',
	);
}

function matchesLuaEmptyStringConditionPattern(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
		return false;
	}
	if (expression.operator !== LuaBinaryOperator.Equal && expression.operator !== LuaBinaryOperator.NotEqual) {
		return false;
	}
	return isLuaEmptyStringLiteral(expression.left) || isLuaEmptyStringLiteral(expression.right);
}

export function lintCppEmptyStringConditionPattern(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
	lintCppAdjacentEqualityComparison(
		file,
		tokens,
		issues,
		emptyStringConditionPatternRule.name,
		'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.',
		(left, right) => (isCppEmptyStringToken(left) && right.kind !== 'string') || (isCppEmptyStringToken(right) && left.kind !== 'string'),
	);
}
