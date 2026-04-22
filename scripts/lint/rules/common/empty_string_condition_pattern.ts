import { LuaBinaryOperator as BinaryOperator, LuaSyntaxKind as SyntaxKind, type LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import { isLuaEmptyStringLiteral as isEmptyStringLiteral } from '../../../../src/bmsx/lua/syntax/literals';
import { isEmptyStringToken } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { lintAdjacentEqualityComparison } from '../cpp/support/comparison';
import type { LintIssue } from '../cpp/support/diagnostics';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const emptyStringConditionPatternRule = defineLintRule('common', 'empty_string_condition_pattern');

export function lintAstEmptyStringConditionPattern(expression: Expression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (!matchesAstEmptyStringConditionPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		emptyStringConditionPatternRule.name,
		expression,
		'Empty-string condition pattern is forbidden. Prefer truthy checks, and do not define empty strings as default/start/empty values.',
	);
}

function matchesAstEmptyStringConditionPattern(expression: Expression): boolean {
	if (expression.kind !== SyntaxKind.BinaryExpression) {
		return false;
	}
	if (expression.operator !== BinaryOperator.Equal && expression.operator !== BinaryOperator.NotEqual) {
		return false;
	}
	return isEmptyStringLiteral(expression.left) || isEmptyStringLiteral(expression.right);
}

export function lintEmptyStringConditionPattern(file: string, tokens: readonly Token[], issues: LintIssue[]): void {
	lintAdjacentEqualityComparison(
		file,
		tokens,
		issues,
		emptyStringConditionPatternRule.name,
		'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.',
		(left, right) => (isEmptyStringToken(left) && right.kind !== 'string') || (isEmptyStringToken(right) && left.kind !== 'string'),
	);
}
