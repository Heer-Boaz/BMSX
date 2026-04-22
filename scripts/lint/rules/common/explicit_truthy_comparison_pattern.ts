import { LuaBinaryOperator as BinaryOperator, LuaSyntaxKind as SyntaxKind, type LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import { isBooleanToken } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { lintAdjacentEqualityComparison } from '../cpp/support/comparison';
import type { LintIssue } from '../cpp/support/diagnostics';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const explicitTruthyComparisonPatternRule = defineLintRule('common', 'explicit_truthy_comparison_pattern');

export function lintAstExplicitTruthyComparisonPattern(expression: Expression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (!matchesAstExplicitTruthyComparisonPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		explicitTruthyComparisonPatternRule.name,
		expression,
		'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
	);
}

function matchesAstExplicitTruthyComparisonPattern(expression: Expression): boolean {
	if (expression.kind !== SyntaxKind.BinaryExpression) {
		return false;
	}
	if (expression.operator !== BinaryOperator.Equal && expression.operator !== BinaryOperator.NotEqual) {
		return false;
	}
	const leftBoolean = isBooleanLiteralExpression(expression.left);
	const rightBoolean = isBooleanLiteralExpression(expression.right);
	if (!leftBoolean && !rightBoolean) {
		return false;
	}
	return !(leftBoolean && rightBoolean);
}

function isBooleanLiteralExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.BooleanLiteralExpression;
}

export function lintExplicitTruthyComparisonPattern(file: string, tokens: readonly Token[], issues: LintIssue[]): void {
	lintAdjacentEqualityComparison(
		file,
		tokens,
		issues,
		explicitTruthyComparisonPatternRule.name,
		'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
		(left, right) => (isBooleanToken(left) && !isBooleanToken(right)) || (isBooleanToken(right) && !isBooleanToken(left)),
	);
}
