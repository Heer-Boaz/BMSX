import { defineLintRule } from '../../rule';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { type LintIssue as LintIssue, pushLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { isNumericSanitizerCall, isSemanticFloorDivisionCall as isAstSemanticFloorDivisionCall } from '../../../../src/bmsx/language/ts/ast/semantic';
import { containsDescendantCallExpression, parentChainContainsCallExpression } from '../../../../src/bmsx/language/ts/ast/expressions';
import { nodeStartLine } from '../ts/support/ast';
import { type FunctionInfo } from '../../../../src/bmsx/language/cpp/syntax/declarations';
import { cppCallTarget, findAccessChainStart } from '../../../../src/bmsx/language/cpp/syntax/syntax';
import { type Token } from '../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue } from '../cpp/support/diagnostics';
import { isNumericSanitizationCall, lineAllowsNumericSanitization, rangeContainsNestedNumericSanitization } from '../cpp/support/numeric';
import { isSemanticFloorDivisionCall as isTokenSemanticFloorDivisionCall } from '../cpp/support/semantic';

export const redundantNumericSanitizationPatternRule = defineLintRule('code_quality', 'redundant_numeric_sanitization_pattern');

export function lintRedundantNumericSanitizationPattern(
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (lineInAnalysisRegion(regions, 'hot-path', nodeStartLine(sourceFile, node)) || !isNumericSanitizerCall(node)) {
		return;
	}
	if (parentChainContainsCallExpression(node.parent, call => call !== node && isNumericSanitizerCall(call))) {
		return;
	}
	if (isAstSemanticFloorDivisionCall(node)) {
		return;
	}
	if (!containsDescendantCallExpression(node, isNumericSanitizerCall)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		redundantNumericSanitizationPatternRule.name,
		'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
	);
}

export function lintTokenRedundantNumericSanitizationPattern(file: string, tokens: readonly Token[], pairs: readonly number[], info: FunctionInfo, regions: readonly AnalysisRegion[], issues: LintIssue[]): void {
	if (lineAllowsNumericSanitization(regions, tokens[info.nameToken].line)) {
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
		if (!isNumericSanitizationCall(tokens, index, target)) {
			continue;
		}
		if (isTokenSemanticFloorDivisionCall(tokens, pairs, index, target)) {
			continue;
		}
		if (lineAllowsNumericSanitization(regions, tokens[index].line)) {
			continue;
		}
		if (activeNumericCalls.length > 0) {
			continue;
		}
		const callStart = findAccessChainStart(tokens, index - 1);
		const callEnd = pairs[index] + 1;
		if (!rangeContainsNestedNumericSanitization(tokens, pairs, callStart, callEnd)) {
			continue;
		}
		pushTokenLintIssue(
			issues,
			file,
			tokens[index],
			redundantNumericSanitizationPatternRule.name,
			'Redundant numeric sanitization is forbidden. Bound values once at the boundary instead of clamping or flooring them repeatedly.',
		);
		activeNumericCalls.push(callEnd);
	}
}
