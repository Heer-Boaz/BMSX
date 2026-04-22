import { defineLintRule } from '../../rule';
import { type LintIssue as LintIssue, pushLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { lineHasAnalysisRegionLabel, type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { callTargetText, expressionContainsPropertyAccess, getPropertyAccessName } from '../../../../src/bmsx/language/ts/ast/expressions';
import { isEqualityOperator, isOrderingComparisonOperator } from '../../../../src/bmsx/language/ts/ast/operators';
import { isNumericContractSentinelExpression, isNumericSanitizerTarget } from '../../../../src/bmsx/language/ts/ast/semantic';
import { nodeStartLine } from '../ts/support/ast';

export const contractNumericDefensiveSanitizationPatternRule = defineLintRule('code_quality', 'contract_numeric_defensive_sanitization_pattern');

export function lintContractNumericDefensiveSanitizationPattern(node: ts.Node, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[], issues: LintIssue[]): void {
	const message = contractNumericDefensiveSanitizationMessage(node, sourceFile, regions);
	if (message === null) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		contractNumericDefensiveSanitizationPatternRule.name,
		message,
	);
}

function contractNumericDefensiveSanitizationMessage(node: ts.Node, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): string | null {
	if (ts.isCallExpression(node) && isContractNumericSanitizerCall(node, sourceFile, regions)) {
		return 'Defensive contract-number sanitization is forbidden. Internal numeric contract values must be bounded once at their owner, not finite/floor/clamp/null-normalized at every use.';
	}
	if (ts.isBinaryExpression(node) && isContractNumericDefensiveComparison(node, sourceFile, regions)) {
		return 'Defensive contract-number sentinel checks are forbidden. Internal numeric contract values must stay in their contract domain instead of being normalized to null or fallback values.';
	}
	if (ts.isTypeOfExpression(node) && expressionContainsContractNumeric(node.expression, sourceFile, regions)) {
		return 'Defensive contract-number type checks are forbidden. Internal numeric contract values are typed contracts, not untrusted payloads.';
	}
	return null;
}

function isContractNumericPropertyAccess(node: ts.Expression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): boolean {
	const propertyName = getPropertyAccessName(node);
	return propertyName !== null && lineHasAnalysisRegionLabel(regions, 'contract-numeric', nodeStartLine(sourceFile, node), propertyName);
}

function expressionContainsContractNumeric(node: ts.Expression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): boolean {
	return expressionContainsPropertyAccess(node, current => isContractNumericPropertyAccess(current, sourceFile, regions));
}

function isContractNumericDefensiveComparison(node: ts.BinaryExpression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): boolean {
	const operator = node.operatorToken.kind;
	if (!isEqualityOperator(operator) && !isOrderingComparisonOperator(operator)) {
		return false;
	}
	return (isContractNumericPropertyAccess(node.left, sourceFile, regions) && isNumericContractSentinelExpression(node.right))
		|| (isContractNumericPropertyAccess(node.right, sourceFile, regions) && isNumericContractSentinelExpression(node.left));
}

function isContractNumericSanitizerCall(node: ts.CallExpression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): boolean {
	if (!isNumericSanitizerTarget(callTargetText(node))) {
		return false;
	}
	for (let index = 0; index < node.arguments.length; index += 1) {
		if (expressionContainsContractNumeric(node.arguments[index], sourceFile, regions)) {
			return true;
		}
	}
	return false;
}
