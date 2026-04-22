import { LuaBinaryOperator as BinaryOperator, type LuaExpression as Expression } from '../../../../src/bmsx/lua/syntax/ast';
import { isLuaEmptyStringLiteral as isEmptyStringLiteral, luaBinaryExpressionHasOperand } from '../../../../src/bmsx/lua/syntax/literals';
import {
	cppRangeIsNull,
	cppRangeHas,
	findTernaryColon,
	findNextDelimiter,
	findPreviousDelimiter,
	isEmptyStringToken,
	trimmedExpressionText,
} from '../../../../src/bmsx/language/cpp/syntax/syntax';
import type { Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue, type LintIssue } from '../cpp/support/diagnostics';
import { nullishNullNormalizationPatternRule } from '../code_quality/nullish_null_normalization_pattern';
import { redundantConditionalPatternRule } from '../code_quality/redundant_conditional_pattern';
import type { CartLintIssue, CartLintIssuePusher } from '../../lua_rule';
import { defineLintRule } from '../../rule';
import { orNilFallbackPatternRule } from './or_nil_fallback_pattern';

export const emptyStringFallbackPatternRule = defineLintRule('common', 'empty_string_fallback_pattern');

export function lintAstEmptyStringFallbackPattern(expression: Expression, issues: CartLintIssue[], pushIssue: CartLintIssuePusher): void {
	if (!luaBinaryExpressionHasOperand(expression, BinaryOperator.Or, isEmptyStringLiteral)) {
		return;
	}
	pushIssue(
		issues,
		emptyStringFallbackPatternRule.name,
		expression,
		'Empty-string fallback via "or \'\'" is forbidden. Do not use empty strings as fallback/default values; keep string truthy-check semantics intact.',
	);
}

export function lintTernaryFallbackPatterns(file: string, tokens: readonly Token[], issues: LintIssue[]): void {
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text === '?') {
			lintTernaryFallback(file, tokens, index, issues);
		}
	}
}

function lintTernaryFallback(file: string, tokens: readonly Token[], questionIndex: number, issues: LintIssue[]): void {
	const statementStart = findPreviousDelimiter(tokens, questionIndex) + 1;
	const statementEnd = findNextDelimiter(tokens, questionIndex);
	const colonIndex = findTernaryColon(tokens, questionIndex, statementEnd);
	if (colonIndex < 0) {
		return;
	}
	const condition = trimmedExpressionText(tokens, statementStart, questionIndex);
	const trueBranch = trimmedExpressionText(tokens, questionIndex + 1, colonIndex);
	const falseBranch = trimmedExpressionText(tokens, colonIndex + 1, statementEnd);
	if (trueBranch === falseBranch) {
		pushTokenLintIssue(issues, file, tokens[questionIndex], redundantConditionalPatternRule.name, 'Conditional expression has identical true/false branches. Keep the value directly.');
	}
	const trueHasEmpty = cppRangeHas(tokens, questionIndex + 1, colonIndex, isEmptyStringToken);
	const falseHasEmpty = cppRangeHas(tokens, colonIndex + 1, statementEnd, isEmptyStringToken);
	if ((condition === trueBranch && falseHasEmpty) || (condition === falseBranch && trueHasEmpty)) {
		pushTokenLintIssue(issues, file, tokens[questionIndex], emptyStringFallbackPatternRule.name, 'Empty-string fallback through a conditional expression is forbidden. Do not use empty strings as default values.');
	}
	const trueHasNull = cppRangeIsNull(tokens, questionIndex + 1, colonIndex);
	const falseHasNull = cppRangeIsNull(tokens, colonIndex + 1, statementEnd);
	if (trueHasNull || falseHasNull) {
		if (isAstNarrowingTernary(condition, trueBranch, falseBranch)) {
			return;
		}
		pushTokenLintIssue(issues, file, tokens[questionIndex], orNilFallbackPatternRule.name, '`nullptr` fallback through a conditional expression is forbidden. Use direct ownership checks or optional state.');
	}
	if ((condition === trueBranch && falseHasNull) || (condition === falseBranch && trueHasNull)) {
		pushTokenLintIssue(issues, file, tokens[questionIndex], nullishNullNormalizationPatternRule.name, 'Conditional nullptr normalization is forbidden. Preserve the actual value or branch explicitly.');
	}
}

function isAstNarrowingTernary(condition: string, trueBranch: string, falseBranch: string): boolean {
	if (!condition.includes('NodeType::')) {
		return false;
	}
	const castBranch = trueBranch === 'nullptr' ? falseBranch : trueBranch;
	const nullBranch = trueBranch === 'nullptr' ? trueBranch : falseBranch;
	return nullBranch === 'nullptr' && castBranch.includes('static_cast<') && castBranch.includes('this');
}
