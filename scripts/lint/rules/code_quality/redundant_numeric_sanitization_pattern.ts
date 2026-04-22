import { defineLintRule } from '../../rule';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../analysis/code_quality/source_scan';
import { containsNestedNumericSanitizationCall, isMinimumRasterPixelSizeCall, isNestedInsideNumericSanitizationCall, isNormalizedColorBytePackingCall, isNumericDefensiveCall } from '../ts/support/numeric';
import { isSemanticFloorDivisionCall } from '../ts/support/semantic';
import { type CppFunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, findCppAccessChainStart } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { type CppToken } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { type CppLintIssue, pushLintIssue } from '../cpp/support/diagnostics';
import { isCppNumericSanitizationCall, rangeContainsNestedCppNumericSanitization } from '../cpp/support/numeric';
import { isCppSemanticFloorDivisionCall } from '../cpp/support/semantic';

export const redundantNumericSanitizationPatternRule = defineLintRule('code_quality', 'redundant_numeric_sanitization_pattern');

export function lintRedundantNumericSanitizationPattern(
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (nodeIsInAnalysisRegion(sourceFile, regions, 'hot-path', node) || !isNumericDefensiveCall(node)) {
		return;
	}
	if (isNestedInsideNumericSanitizationCall(node, node.parent)) {
		return;
	}
	if (isSemanticFloorDivisionCall(node)) {
		return;
	}
	if (isMinimumRasterPixelSizeCall(node, sourceFile)) {
		return;
	}
	if (isNormalizedColorBytePackingCall(node)) {
		return;
	}
	if (!containsNestedNumericSanitizationCall(node)) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		redundantNumericSanitizationPatternRule.name,
		'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
	);
}

export function lintCppRedundantNumericSanitizationPattern(file: string, tokens: readonly CppToken[], pairs: readonly number[], info: CppFunctionInfo, regions: readonly AnalysisRegion[], issues: CppLintIssue[]): void {
	if (lineInAnalysisRegion(regions, 'numeric-sanitization-acceptable', tokens[info.nameToken].line)) {
		return;
	}
	if (lineInAnalysisRegion(regions, 'hot-path', tokens[info.nameToken].line)) {
		return;
	}
	const activeNumericCalls: number[] = [];
	for (let index = info.bodyStart + 1; index < info.bodyEnd; index += 1) {
		while (activeNumericCalls.length > 0 && activeNumericCalls[activeNumericCalls.length - 1] <= index) {
			activeNumericCalls.pop();
		}
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > info.bodyEnd) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (!isCppNumericSanitizationCall(tokens, index, target)) {
			continue;
		}
		if (isCppSemanticFloorDivisionCall(tokens, pairs, index, target)) {
			continue;
		}
		if (activeNumericCalls.length > 0) {
			continue;
		}
		const callStart = findCppAccessChainStart(tokens, index - 1);
		const callEnd = pairs[index] + 1;
		if (!rangeContainsNestedCppNumericSanitization(tokens, pairs, callStart, callEnd)) {
			continue;
		}
		pushLintIssue(
			issues,
			file,
			tokens[index],
			redundantNumericSanitizationPatternRule.name,
			'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
		);
		activeNumericCalls.push(callEnd);
	}
}
