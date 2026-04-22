import { LuaBinaryOperator, type LuaExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { isLuaEmptyStringLiteral, luaBinaryExpressionHasOperand } from '../../../../src/bmsx/lua/syntax/literals';
import {
	cppRangeIsNull,
	cppRangeHas,
	findCppTernaryColon,
	findNextCppDelimiter,
	findPreviousCppDelimiter,
	isCppEmptyStringToken,
	trimmedCppExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from '../cpp/support/diagnostics';
import { nullishNullNormalizationPatternRule } from '../code_quality/nullish_null_normalization_pattern';
import { redundantConditionalPatternRule } from '../code_quality/redundant_conditional_pattern';
import type { LuaLintIssue, LuaLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';
import { orNilFallbackPatternRule } from './or_nil_fallback_pattern';

export const emptyStringFallbackPatternRule = defineLintRule('common', 'empty_string_fallback_pattern');

export function lintLuaEmptyStringFallbackPattern(expression: LuaExpression, issues: LuaLintIssue[], pushIssue: LuaLintIssuePusher): void {
	if (!luaBinaryExpressionHasOperand(expression, LuaBinaryOperator.Or, isLuaEmptyStringLiteral)) {
		return;
	}
	pushIssue(
		issues,
		emptyStringFallbackPatternRule.name,
		expression,
		'Empty-string fallback via "or \'\'" is forbidden. Do not use empty strings as fallback/default values; keep string truthy-check semantics intact.',
	);
}

export function lintCppTernaryFallbackPatterns(file: string, tokens: readonly CppToken[], issues: CppLintIssue[]): void {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text === '?') {
			lintCppTernaryFallback(file, tokens, index, issues);
		}
	}
}

function lintCppTernaryFallback(file: string, tokens: readonly CppToken[], questionIndex: number, issues: CppLintIssue[]): void {
	const statementStart = findPreviousCppDelimiter(tokens, questionIndex) + 1;
	const statementEnd = findNextCppDelimiter(tokens, questionIndex);
	const colonIndex = findCppTernaryColon(tokens, questionIndex, statementEnd);
	if (colonIndex < 0) {
		return;
	}
	const condition = trimmedCppExpressionText(tokens, statementStart, questionIndex);
	const trueBranch = trimmedCppExpressionText(tokens, questionIndex + 1, colonIndex);
	const falseBranch = trimmedCppExpressionText(tokens, colonIndex + 1, statementEnd);
	if (trueBranch === falseBranch) {
		pushLintIssue(issues, file, tokens[questionIndex], redundantConditionalPatternRule.name, 'Conditional expression has identical true/false branches. Keep the value directly.');
	}
	const trueHasEmpty = cppRangeHas(tokens, questionIndex + 1, colonIndex, isCppEmptyStringToken);
	const falseHasEmpty = cppRangeHas(tokens, colonIndex + 1, statementEnd, isCppEmptyStringToken);
	if ((condition === trueBranch && falseHasEmpty) || (condition === falseBranch && trueHasEmpty)) {
		pushLintIssue(issues, file, tokens[questionIndex], emptyStringFallbackPatternRule.name, 'Empty-string fallback through a conditional expression is forbidden. Do not use empty strings as default values.');
	}
	const trueHasNull = cppRangeIsNull(tokens, questionIndex + 1, colonIndex);
	const falseHasNull = cppRangeIsNull(tokens, colonIndex + 1, statementEnd);
	if (trueHasNull || falseHasNull) {
		if (isCppAstNarrowingTernary(condition, trueBranch, falseBranch)) {
			return;
		}
		pushLintIssue(issues, file, tokens[questionIndex], orNilFallbackPatternRule.name, '`nullptr` fallback through a conditional expression is forbidden. Use direct ownership checks or optional state.');
	}
	if ((condition === trueBranch && falseHasNull) || (condition === falseBranch && trueHasNull)) {
		pushLintIssue(issues, file, tokens[questionIndex], nullishNullNormalizationPatternRule.name, 'Conditional nullptr normalization is forbidden. Preserve the actual value or branch explicitly.');
	}
}

function isCppAstNarrowingTernary(condition: string, trueBranch: string, falseBranch: string): boolean {
	if (!condition.includes('NodeType::')) {
		return false;
	}
	const castBranch = trueBranch === 'nullptr' ? falseBranch : trueBranch;
	const nullBranch = trueBranch === 'nullptr' ? trueBranch : falseBranch;
	return nullBranch === 'nullptr' && castBranch.includes('static_cast<') && castBranch.includes('this');
}
