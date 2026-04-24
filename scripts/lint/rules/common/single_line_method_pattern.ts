import { defineLintRule } from '../../rule';
import { type AnalysisRegion } from '../../../analysis/lint_suppressions';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../analysis/code_quality/source_scan';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
import { isSingleLineWrapperCandidate } from '../ts/support/declarations';

export const singleLineMethodPatternRule = defineLintRule('common', 'single_line_method_pattern');

export function lintSingleLineMethodPattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (!isSingleLineWrapperCandidate(node, sourceFile) || nodeIsInAnalysisRegion(sourceFile, regions, singleLineMethodPatternRule.name, node)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.name ?? node,
		singleLineMethodPatternRule.name,
		'Single-line wrapper function/method is forbidden. Prefer direct logic over delegation wrappers.',
	);
}
