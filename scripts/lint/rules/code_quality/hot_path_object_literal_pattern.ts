import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue, unwrapExpression } from '../ts/support/ast';

export const hotPathObjectLiteralPatternRule = defineLintRule('code_quality', 'hot_path_object_literal_pattern');

export function lintHotPathObjectLiteralArgument(argument: ts.Expression, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const unwrapped = unwrapExpression(argument);
	if (!ts.isObjectLiteralExpression(unwrapped) && !ts.isArrayLiteralExpression(unwrapped)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		unwrapped,
		hotPathObjectLiteralPatternRule.name,
		'Object/array literal payload allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.',
	);
}
