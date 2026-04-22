import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { LintIssue, nodeStartLine, pushLintIssue } from '../ts/support/ast';
import { isNumericDefensiveCall } from '../ts/support/numeric';

export const numericDefensiveSanitizationPatternRule = defineLintRule('code_quality', 'numeric_defensive_sanitization_pattern');

export function lintNumericDefensiveSanitizationPattern(node: ts.CallExpression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[], issues: LintIssue[]): void {
	if (!lineInAnalysisRegion(regions, 'hot-path', nodeStartLine(sourceFile, node)) || !isNumericDefensiveCall(node)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		numericDefensiveSanitizationPatternRule.name,
		'Defensive numeric sanitization in IDE hot paths is forbidden. Coordinates and layout values must already be valid integers.',
	);
}
