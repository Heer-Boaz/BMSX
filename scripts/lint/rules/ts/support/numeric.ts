import ts from 'typescript';
import { unwrapExpression } from './ast';
import { callTargetText } from './calls';
import { isEqualityOperator, isOrderingComparisonOperator } from './conditions';
import { hasPrivateOrProtectedModifier } from './runtime_patterns';

export const CONTRACT_NUMERIC_NAMES = new Set([
	'column',
	'col',
	'line',
	'row',
]);

export const CONTRACT_NUMERIC_SANITIZERS = new Set([
	'Math.ceil',
	'Math.floor',
	'Math.max',
	'Math.min',
	'Math.round',
	'Math.trunc',
	'Number.isFinite',
	'clamp',
	'clamp_fallback',
]);

export function containsNestedNumericSanitizationCall(node: ts.Node): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (current !== node && ts.isCallExpression(current) && isNumericDefensiveCall(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

export function isNestedInsideNumericSanitizationCall(node: ts.CallExpression, parent: ts.Node | undefined): boolean {
	let current = parent;
	while (
		current !== undefined
		&& (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current))
	) {
		current = current.parent;
	}
	while (current !== undefined) {
		if (ts.isCallExpression(current) && current !== node && isNumericDefensiveCall(current)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

export function isMinimumRasterPixelSizeCall(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
	if (callTargetText(node) !== 'Math.max' || node.arguments.length !== 2) {
		return false;
	}
	let roundedArgument: ts.Expression | null = null;
	if (isNumericLiteralText(node.arguments[0], '1')) {
		roundedArgument = node.arguments[1];
	} else if (isNumericLiteralText(node.arguments[1], '1')) {
		roundedArgument = node.arguments[0];
	}
	if (roundedArgument === null) {
		return false;
	}
	const roundedCall = unwrapExpression(roundedArgument);
	if (!ts.isCallExpression(roundedCall) || callTargetText(roundedCall) !== 'Math.round' || roundedCall.arguments.length !== 1) {
		return false;
	}
	const roundedText = roundedCall.arguments[0].getText(sourceFile).replace(/\s+/g, ' ');
	if (/\bthickness(?:Value)?\b/.test(roundedText)) {
		return true;
	}
	return /\b(?:width|height)\b.*\bscale[XY]\b/i.test(roundedText)
		|| /\bscale[XY]\b.*\b(?:width|height)\b/i.test(roundedText)
		|| /\b(?:width|height)\b.*\bscale\s*(?:!|\?)?\.\s*[xy]\b/i.test(roundedText)
		|| /\bscale\s*(?:!|\?)?\.\s*[xy]\b.*\b(?:width|height)\b/i.test(roundedText);
}

export function isNormalizedColorBytePackingCall(node: ts.CallExpression): boolean {
	if (callTargetText(node) !== 'Math.round' || node.arguments.length !== 1) {
		return false;
	}
	const arg = unwrapExpression(node.arguments[0]);
	if (!ts.isBinaryExpression(arg) || arg.operatorToken.kind !== ts.SyntaxKind.AsteriskToken) {
		return false;
	}
	const leftIsScale = isNumericLiteralText(arg.left, '255');
	const rightIsScale = isNumericLiteralText(arg.right, '255');
	if (leftIsScale === rightIsScale) {
		return false;
	}
	const normalized = unwrapExpression(leftIsScale ? arg.right : arg.left);
	if (!ts.isCallExpression(normalized) || callTargetText(normalized) !== 'clamp' || normalized.arguments.length !== 3) {
		return false;
	}
	return isNumericLiteralText(normalized.arguments[1], '0')
		&& isNumericLiteralText(normalized.arguments[2], '1');
}

export function isNumericDefensiveCall(node: ts.CallExpression): boolean {
	const target = callTargetText(node);
	return target === 'Math.floor'
		|| target === 'Math.max'
		|| target === 'Math.min'
		|| target === 'Math.round'
		|| target === 'Math.ceil'
		|| target === 'Math.trunc'
		|| target === 'Number.isFinite'
		|| target === 'clamp';
}

export function isContractNumericPropertyAccess(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (!ts.isPropertyAccessExpression(unwrapped)) {
		return false;
	}
	return CONTRACT_NUMERIC_NAMES.has(unwrapped.name.text);
}

export function expressionContainsContractNumeric(node: ts.Expression): boolean {
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

export function isContractNumericSentinelExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (ts.isNumericLiteral(unwrapped)) {
		return unwrapped.text === '0' || unwrapped.text === '1' || unwrapped.text === 'Number.MAX_SAFE_INTEGER';
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
	return false;
}

export function isContractNumericDefensiveComparison(node: ts.BinaryExpression): boolean {
	const operator = node.operatorToken.kind;
	if (!isEqualityOperator(operator) && !isOrderingComparisonOperator(operator)) {
		return false;
	}
	return (isContractNumericPropertyAccess(node.left) && isContractNumericSentinelExpression(node.right))
		|| (isContractNumericPropertyAccess(node.right) && isContractNumericSentinelExpression(node.left));
}

export function isContractNumericSanitizerCall(node: ts.CallExpression): boolean {
	const target = callTargetText(node);
	if (target === null || !CONTRACT_NUMERIC_SANITIZERS.has(target)) {
		return false;
	}
	for (let index = 0; index < node.arguments.length; index += 1) {
		if (expressionContainsContractNumeric(node.arguments[index])) {
			return true;
		}
	}
	return false;
}

export function isNumericLiteralText(node: ts.Expression, value: string): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isNumericLiteral(unwrapped) && unwrapped.text === value;
}

export function isNumericLiteralLike(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (ts.isNumericLiteral(unwrapped)) {
		return true;
	}
	if (ts.isPrefixUnaryExpression(unwrapped) && (unwrapped.operator === ts.SyntaxKind.MinusToken || unwrapped.operator === ts.SyntaxKind.PlusToken)) {
		return ts.isNumericLiteral(unwrapExpression(unwrapped.operand));
	}
	return false;
}

export function isPublicContractMethod(functionNode: ts.Node): boolean {
	return ts.isMethodDeclaration(functionNode) && !hasPrivateOrProtectedModifier(functionNode);
}
