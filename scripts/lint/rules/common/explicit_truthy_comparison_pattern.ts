import { LuaBinaryOperator, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { isCppBooleanToken } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { pushLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';

export const explicitTruthyComparisonPatternRule = defineLintRule('common', 'explicit_truthy_comparison_pattern');

export function lintLuaExplicitTruthyComparisonPattern(expression: LuaExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (!matchesLuaExplicitTruthyComparisonPattern(expression)) {
		return;
	}
	pushIssue(
		issues,
		explicitTruthyComparisonPatternRule.name,
		expression,
		'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
	);
}

function matchesLuaExplicitTruthyComparisonPattern(expression: LuaExpression): boolean {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
		return false;
	}
	if (expression.operator !== LuaBinaryOperator.Equal && expression.operator !== LuaBinaryOperator.NotEqual) {
		return false;
	}
	const leftBoolean = isLuaBooleanLiteralExpression(expression.left);
	const rightBoolean = isLuaBooleanLiteralExpression(expression.right);
	if (!leftBoolean && !rightBoolean) {
		return false;
	}
	return !(leftBoolean && rightBoolean);
}

function isLuaBooleanLiteralExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.BooleanLiteralExpression;
}

export function lintCppExplicitTruthyComparisonPattern(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== '==' && token.text !== '!=') {
			continue;
		}
		const left = tokens[index - 1];
		const right = tokens[index + 1];
		if (left === undefined || right === undefined) {
			continue;
		}
		if ((isCppBooleanToken(left) && !isCppBooleanToken(right)) || (isCppBooleanToken(right) && !isCppBooleanToken(left))) {
			pushLintIssue(issues, file, token, explicitTruthyComparisonPatternRule.name, 'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.');
		}
	}
}
