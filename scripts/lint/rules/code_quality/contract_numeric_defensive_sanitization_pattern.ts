import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { expressionContainsContractNumeric, isContractNumericDefensiveComparison, isContractNumericSanitizerCall } from '../ts/support/numeric';

export const contractNumericDefensiveSanitizationPatternRule = defineLintRule('code_quality', 'contract_numeric_defensive_sanitization_pattern');

export function lintContractNumericDefensiveSanitizationPattern(node: ts.Node, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (ts.isCallExpression(node) && isContractNumericSanitizerCall(node)) {
		pushTsLintIssue(
			issues,
			sourceFile,
			node,
			contractNumericDefensiveSanitizationPatternRule.name,
			'Defensive contract-number sanitization is forbidden. Internal line/column/row values must be bounded once at their owner, not finite/floor/clamp/null-normalized at every use.',
		);
		return;
	}
	if (ts.isBinaryExpression(node) && isContractNumericDefensiveComparison(node)) {
		pushTsLintIssue(
			issues,
			sourceFile,
			node,
			contractNumericDefensiveSanitizationPatternRule.name,
			'Defensive contract-number sentinel checks are forbidden. Internal line/column/row values must stay in their contract domain instead of being normalized to null or fallback coordinates.',
		);
		return;
	}
	if (ts.isTypeOfExpression(node) && expressionContainsContractNumeric(node.expression)) {
		pushTsLintIssue(
			issues,
			sourceFile,
			node,
			contractNumericDefensiveSanitizationPatternRule.name,
			'Defensive contract-number type checks are forbidden. Internal line/column/row values are typed contracts, not untrusted payloads.',
		);
	}
}
