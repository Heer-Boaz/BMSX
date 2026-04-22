import { type CppFunctionInfo } from '../../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, isCppFunctionDeclaratorParen, splitCppArgumentRanges } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type CppLintIssue, pushTokenLintIssue } from '../support/diagnostics';
import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import { hotPathClosureArgumentPatternRule } from '../../code_quality/hot_path_closure_argument_pattern';
import { hotPathObjectLiteralPatternRule } from '../../code_quality/hot_path_object_literal_pattern';
import { numericDefensiveSanitizationPatternRule } from '../../code_quality/numeric_defensive_sanitization_pattern';
import { rangeContainsCapturingLambda, rangeContainsTemporaryAllocation } from '../support/ast';
import { isHotPathFunction, shouldReportCppHotPathNumericSanitization } from '../support/numeric';

export function lintCppHotPathCalls(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[]): void {
	if (!isHotPathFunction(info, regions, tokens)) {
		return;
	}
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] >= info.bodyEnd) {
			continue;
		}
		if (isCppFunctionDeclaratorParen(tokens, pairs, index)) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target === null) {
			continue;
		}
		if (shouldReportCppHotPathNumericSanitization(tokens, pairs, regions, index, target)) {
			pushTokenLintIssue(issues, file, tokens[index - 1], numericDefensiveSanitizationPatternRule.name, 'Defensive numeric sanitization in hot paths is forbidden. Coordinates, cycles, and layout values must already be valid.');
		}
		const args = splitCppArgumentRanges(tokens, index + 1, pairs[index]);
		for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
			const argStart = args[argIndex][0];
			const argEnd = args[argIndex][1];
			if (rangeContainsCapturingLambda(tokens, argStart, argEnd)) {
				pushTokenLintIssue(issues, file, tokens[argStart], hotPathClosureArgumentPatternRule.name, 'Lambda/closure argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.');
			}
			if (rangeContainsTemporaryAllocation(tokens, argStart, argEnd)) {
				pushTokenLintIssue(issues, file, tokens[argStart], hotPathObjectLiteralPatternRule.name, 'Temporary object/container allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.');
			}
		}
	}
}
