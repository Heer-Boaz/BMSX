import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue, unwrapExpression } from '../ts/support/ast';
import { isFunctionExpressionLike } from '../ts/support/functions';
import { containsClosureExpression } from '../ts/support/runtime_patterns';

export const hotPathClosureArgumentPatternRule = defineLintRule('code_quality', 'hot_path_closure_argument_pattern');

export function lintHotPathClosureArgument(argument: ts.Expression, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const unwrapped = unwrapExpression(argument);
	if (!isFunctionExpressionLike(unwrapped) && !containsClosureExpression(unwrapped)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		unwrapped,
		hotPathClosureArgumentPatternRule.name,
		'Closure/function argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.',
	);
}
