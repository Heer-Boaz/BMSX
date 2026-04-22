import ts from 'typescript';
import { defineLintRule } from '../../rule';
import { pushTsLintIssue, type TsLintIssue } from '../../ts_rule';

export const redundantConditionalPatternRule = defineLintRule('code_quality', 'redundant_conditional_pattern');

function compactExpressionText(node: ts.Expression, sourceFile: ts.SourceFile): string {
	return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}

export function isRedundantConditionalExpression(node: ts.ConditionalExpression, sourceFile: ts.SourceFile): boolean {
	return compactExpressionText(node.whenTrue, sourceFile) === compactExpressionText(node.whenFalse, sourceFile);
}

export function lintRedundantConditionalPattern(
	sourceFile: ts.SourceFile,
	node: ts.ConditionalExpression,
	issues: TsLintIssue[],
): void {
	if (!isRedundantConditionalExpression(node, sourceFile)) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		redundantConditionalPatternRule.name,
		'Conditional expression has identical true/false branches. Keep the value directly.',
	);
}
