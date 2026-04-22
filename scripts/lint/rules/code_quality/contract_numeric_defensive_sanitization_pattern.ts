import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { unwrapExpression } from '../ts/support/ast';
import { callTargetText } from '../ts/support/calls';
import { isEqualityOperator, isOrderingComparisonOperator } from '../ts/support/conditions';

export const contractNumericDefensiveSanitizationPatternRule = defineLintRule('code_quality', 'contract_numeric_defensive_sanitization_pattern');

export function lintContractNumericDefensiveSanitizationPattern(node: ts.Node, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const message = contractNumericDefensiveSanitizationMessage(node);
	if (message === null) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		contractNumericDefensiveSanitizationPatternRule.name,
		message,
	);
}

function contractNumericDefensiveSanitizationMessage(node: ts.Node): string | null {
	if (ts.isCallExpression(node) && isContractNumericSanitizerCall(node)) {
		return 'Defensive contract-number sanitization is forbidden. Internal line/column/row values must be bounded once at their owner, not finite/floor/clamp/null-normalized at every use.';
	}
	if (ts.isBinaryExpression(node) && isContractNumericDefensiveComparison(node)) {
		return 'Defensive contract-number sentinel checks are forbidden. Internal line/column/row values must stay in their contract domain instead of being normalized to null or fallback coordinates.';
	}
	if (ts.isTypeOfExpression(node) && expressionContainsContractNumeric(node.expression)) {
		return 'Defensive contract-number type checks are forbidden. Internal line/column/row values are typed contracts, not untrusted payloads.';
	}
	return null;
}

function isContractNumericPropertyAccess(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (!ts.isPropertyAccessExpression(unwrapped)) {
		return false;
	}
	switch (unwrapped.name.text) {
		case 'column':
		case 'col':
		case 'line':
		case 'row':
			return true;
		default:
			return false;
	}
}

function expressionContainsContractNumeric(node: ts.Expression): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isPropertyAccessExpression(current) && isContractNumericPropertyAccess(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

function isContractNumericSentinelExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (ts.isNumericLiteral(unwrapped)) {
		return unwrapped.text === '0' || unwrapped.text === '1';
	}
	if (unwrapped.kind === ts.SyntaxKind.NullKeyword || unwrapped.kind === ts.SyntaxKind.UndefinedKeyword) {
		return true;
	}
	if (ts.isIdentifier(unwrapped)) {
		return unwrapped.text === 'undefined';
	}
	if (ts.isStringLiteral(unwrapped)) {
		return unwrapped.text === 'number';
	}
	return ts.isPropertyAccessExpression(unwrapped)
		&& ts.isIdentifier(unwrapped.expression)
		&& unwrapped.expression.text === 'Number'
		&& unwrapped.name.text === 'MAX_SAFE_INTEGER';
}

function isContractNumericDefensiveComparison(node: ts.BinaryExpression): boolean {
	const operator = node.operatorToken.kind;
	if (!isEqualityOperator(operator) && !isOrderingComparisonOperator(operator)) {
		return false;
	}
	return (isContractNumericPropertyAccess(node.left) && isContractNumericSentinelExpression(node.right))
		|| (isContractNumericPropertyAccess(node.right) && isContractNumericSentinelExpression(node.left));
}

function isContractNumericSanitizerCall(node: ts.CallExpression): boolean {
	if (!isContractNumericSanitizerTarget(callTargetText(node))) {
		return false;
	}
	for (let index = 0; index < node.arguments.length; index += 1) {
		if (expressionContainsContractNumeric(node.arguments[index])) {
			return true;
		}
	}
	return false;
}

function isContractNumericSanitizerTarget(target: string | null): boolean {
	switch (target) {
		case 'Math.ceil':
		case 'Math.floor':
		case 'Math.max':
		case 'Math.min':
		case 'Math.round':
		case 'Math.trunc':
		case 'Number.isFinite':
		case 'clamp':
		case 'clamp_fallback':
			return true;
		default:
			return false;
	}
}
