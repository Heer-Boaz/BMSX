import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { lineInAnalysisRegion, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../analysis/quality_ledger';
import { LintIssue, isInsideConstructor, nodeStartLine, pushLintIssue } from '../ts/support/ast';
import { isAllocationExpression } from '../ts/support/runtime_patterns';

export const allocationFallbackPatternRule = defineLintRule('code_quality', 'allocation_fallback_pattern');

export function lintAllocationFallbackPattern(
	node: ts.BinaryExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
	ledger: QualityLedger,
): void {
	if (node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) {
		return;
	}
	if (!isAllocationExpression(node.right) || lineInAnalysisRegion(regions, 'allocation-fallback-acceptable', nodeStartLine(sourceFile, node))) {
		return;
	}
	if (isInsideConstructor(node)) {
		noteQualityLedger(ledger, 'allowed_allocation_fallback_constructor_default');
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.operatorToken,
		allocationFallbackPatternRule.name,
		'Allocation fallback via `??` is forbidden. Use shared defaults, explicit branches, or require ownership at the call boundary.',
	);
}
