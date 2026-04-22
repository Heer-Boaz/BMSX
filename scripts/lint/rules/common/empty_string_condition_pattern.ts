import { LuaBinaryOperator, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import type { LuaExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { isCppEmptyStringToken } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import type { CppLintIssue } from '../../../analysis/cpp_quality/diagnostics';
import { pushLintIssue } from '../../../analysis/cpp_quality/diagnostics';
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

function isLuaEmptyStringLiteral(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.StringLiteralExpression && expression.value === '';
}

export function lintCppEmptyStringConditionPattern(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
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
		if ((isCppEmptyStringToken(left) && right.kind !== 'string') || (isCppEmptyStringToken(right) && left.kind !== 'string')) {
			pushLintIssue(issues, file, token, emptyStringConditionPatternRule.name, 'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.');
		}
	}
}
