import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
import { isSingleLineWrapperCandidate } from '../ts/support/declarations';
import { isAllowedBySingleLineFunctionUsage } from '../ts/support/function_usage';
import { type FunctionUsageInfo } from '../ts/support/types';

export const singleLineMethodPatternRule = defineLintRule('common', 'single_line_method_pattern');

export function lintSingleLineMethodPattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	functionUsageInfo: FunctionUsageInfo,
	issues: LintIssue[],
): void {
	if (!isSingleLineWrapperCandidate(node, sourceFile) || isAllowedBySingleLineFunctionUsage(node, functionUsageInfo)) {
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
