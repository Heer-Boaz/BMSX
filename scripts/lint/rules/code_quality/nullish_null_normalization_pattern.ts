import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { isNullOrUndefined } from '../../../../src/bmsx/language/ts/ast/literals';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
import { isConditionalNullishNormalization } from '../ts/support/nullish';

export const nullishNullNormalizationPatternRule = defineLintRule('code_quality', 'nullish_null_normalization_pattern');

export function lintNullishNullNormalizationPattern(node: ts.BinaryExpression | ts.ConditionalExpression, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (ts.isBinaryExpression(node)) {
		if (node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken || !isNullOrUndefined(node.right)) {
			return;
		}
		pushLintIssue(
			issues,
			sourceFile,
			node.operatorToken,
			nullishNullNormalizationPatternRule.name,
			'`?? null`/`?? undefined` normalization is forbidden. Preserve undefined/null directly or handle the case explicitly.',
		);
		return;
	}
	if (!isConditionalNullishNormalization(node)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		nullishNullNormalizationPatternRule.name,
		'Conditional null/undefined normalization is forbidden. Preserve the actual value or branch explicitly.',
	);
}
