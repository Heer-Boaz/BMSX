import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
import { isEmptyContainerLiteral } from '../ts/support/conditions';

export const emptyContainerFallbackPatternRule = defineLintRule('common', 'empty_container_fallback_pattern');

export function lintEmptyContainerFallbackPattern(node: ts.BinaryExpression, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken || !isEmptyContainerLiteral(node.right)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.operatorToken,
		emptyContainerFallbackPatternRule.name,
		'`?? []`/`?? {}` fallback allocation is forbidden. Use a shared empty value, a direct branch, or keep ownership explicit.',
	);
}
