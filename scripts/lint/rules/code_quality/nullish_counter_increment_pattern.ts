import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
import { isNullishCounterIncrement } from '../ts/support/nullish';

export const nullishCounterIncrementPatternRule = defineLintRule('code_quality', 'nullish_counter_increment_pattern');

export function lintNullishCounterIncrementPattern(node: ts.BinaryExpression, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (!isNullishCounterIncrement(node)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.operatorToken,
		nullishCounterIncrementPatternRule.name,
		'Counter increment through `?? 0` is forbidden. Initialize the counter at the owner boundary and increment directly.',
	);
}
