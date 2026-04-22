import type { TsLintIssue } from '../../ts_rule';
import type { RepeatedExpressionInfo } from '../ts/support/ast';
import { defineLintRule } from '../../rule';
import { type CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, findCppAccessChainStart } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken, normalizedCppTokenText } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { type CppLintIssue } from '../cpp/support/diagnostics';
import { compactSampleText } from '../cpp/support/ast';
import { isCppNumericSanitizationCall } from '../cpp/support/numeric';
import { collectSemanticNormalizationCallSignatures, cppSemanticRepeatedExpressionMinCount, isSemanticNormalizationWrapperTarget, isSemanticValidationPredicateTarget, semanticCppExpressionFingerprint } from '../cpp/support/semantic';

export const semanticRepeatedExpressionPatternRule = defineLintRule('code_quality', 'semantic_repeated_expression_pattern');

const MIN_SEMANTIC_REPEATED_EXPRESSION_COUNT = 3;

export function addSemanticRepeatedExpressionIssues(
	scope: ReadonlyMap<string, RepeatedExpressionInfo>,
	fileName: string,
	issues: TsLintIssue[],
): void {
	for (const info of scope.values()) {
		if (info.count < MIN_SEMANTIC_REPEATED_EXPRESSION_COUNT) {
			continue;
		}
		issues.push({
			kind: semanticRepeatedExpressionPatternRule.name,
			file: fileName,
			line: info.line,
			column: info.column,
			name: semanticRepeatedExpressionPatternRule.name,
			message: `Semantic transform call is repeated ${info.count} times in the same scope: ${info.sampleText}`,
		});
	}
}

export function lintCppSemanticRepeatedExpressions(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, issues: CppLintIssue[]): void {
	const expressions = new Map<string, { token: CppToken; count: number; sampleText: string; target: string }>();
	const semanticCallSignatures = collectSemanticNormalizationCallSignatures(tokens, pairs, info.bodyStart + 1, info.bodyEnd);
	const semanticTargetPrefix = semanticCallSignatures.join('|');
	const activeSemanticCalls: number[] = [];
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		while (activeSemanticCalls.length > 0 && activeSemanticCalls[activeSemanticCalls.length - 1] <= index) {
			activeSemanticCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] >= info.bodyEnd) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null || (!isCppNumericSanitizationCall(tokens, index, target) && !isSemanticNormalizationWrapperTarget(target))) {
			continue;
		}
		if (isSemanticValidationPredicateTarget(target)) {
			continue;
		}
		if (activeSemanticCalls.length > 0) {
			continue;
		}
		const callStart = findCppAccessChainStart(tokens, index - 1);
		const callEnd = pairs[index] + 1;
		const text = normalizedCppTokenText(tokens, callStart, callEnd);
		if (text.length < 24 || text.startsWith('this.') || text.startsWith('this->')) {
			continue;
		}
		const fingerprint = semanticTargetPrefix.length > 0
			? `${semanticTargetPrefix}|${semanticCppExpressionFingerprint(target, tokens, callStart, callEnd)}`
			: semanticCppExpressionFingerprint(target, tokens, callStart, callEnd);
		const existing = expressions.get(fingerprint);
		if (existing !== undefined) {
			existing.count += 1;
			continue;
		}
		expressions.set(fingerprint, {
			token: tokens[callStart],
			count: 1,
			sampleText: compactSampleText(text),
			target,
		});
		activeSemanticCalls.push(callEnd);
	}
	for (const value of expressions.values()) {
		if (value.count < cppSemanticRepeatedExpressionMinCount(value.target)) {
			continue;
		}
		issues.push({
			kind: semanticRepeatedExpressionPatternRule.name,
			file,
			line: value.token.line,
			column: value.token.column,
			name: semanticRepeatedExpressionPatternRule.name,
			message: `Semantic transform call is repeated ${value.count} times in the same scope: ${value.sampleText}`,
		});
	}
}
