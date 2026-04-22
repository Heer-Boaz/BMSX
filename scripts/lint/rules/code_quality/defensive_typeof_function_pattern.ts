import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue } from '../ts/support/ast';
import { isTypeofFunctionComparison } from '../ts/support/conditions';

export const defensiveTypeofFunctionPatternRule = defineLintRule('code_quality', 'defensive_typeof_function_pattern');

export function lintDefensiveTypeofFunctionPattern(node: ts.BinaryExpression, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (!isTypeofFunctionComparison(node)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.operatorToken,
		defensiveTypeofFunctionPatternRule.name,
		'`typeof x === "function"` is forbidden. Trust callable contracts, use optional calls for optional members, or suppress a proven external boundary locally.',
	);
}
