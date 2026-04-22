import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { lineHasAnalysisRegionLabel, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { LintIssue, expressionRootName, nodeStartLine, pushLintIssue } from '../ts/support/ast';
import { hasQuestionDotToken } from '../ts/support/calls';

export const defensiveOptionalChainPatternRule = defineLintRule('code_quality', 'defensive_optional_chain_pattern');

export function lintRequiredStateOptionalChainPattern(
	node: ts.Expression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): boolean {
	if (!hasQuestionDotToken(node)) {
		return false;
	}
	const root = expressionRootName(node);
	if (root === null || !lineHasAnalysisRegionLabel(regions, 'required-state', nodeStartLine(sourceFile, node), root)) {
		return false;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		defensiveOptionalChainPatternRule.name,
		`Optional chaining on required state root "${root}" is forbidden.`,
	);
	return true;
}
