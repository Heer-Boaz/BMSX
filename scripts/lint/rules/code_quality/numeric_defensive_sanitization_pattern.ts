import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { LintIssue, nodeStartLine, pushLintIssue } from '../ts/support/ast';
import { callTargetText } from '../ts/support/calls';

export const numericDefensiveSanitizationPatternRule = defineLintRule('code_quality', 'numeric_defensive_sanitization_pattern');

export function lintNumericDefensiveSanitizationPattern(node: ts.CallExpression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[], issues: LintIssue[]): void {
	if (!isHotPathNumericDefensiveSanitization(node, sourceFile, regions)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		numericDefensiveSanitizationPatternRule.name,
		'Defensive numeric sanitization in hot-path regions is forbidden. Hot-path values must already be bounded by their owner or boundary.',
	);
}

function isHotPathNumericDefensiveSanitization(node: ts.CallExpression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): boolean {
	return lineInAnalysisRegion(regions, 'hot-path', nodeStartLine(sourceFile, node))
		&& isNumericDefensiveSanitizationCall(node);
}

export function isNumericDefensiveSanitizationCall(node: ts.CallExpression): boolean {
	switch (callTargetText(node)) {
		case 'Math.floor':
		case 'Math.max':
		case 'Math.min':
		case 'Math.round':
		case 'Math.ceil':
		case 'Math.trunc':
		case 'Number.isFinite':
		case 'clamp':
			return true;
		default:
			return false;
	}
}
