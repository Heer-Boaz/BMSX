import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { unwrapExpression } from '../../../../src/bmsx/language/ts/ast/expressions';
import { isFunctionExpressionLike } from '../../../../src/bmsx/language/ts/ast/functions';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
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
