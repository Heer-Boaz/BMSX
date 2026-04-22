import ts from 'typescript';
import { unwrapExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { isBooleanLiteral, isEmptyStringLiteral, isStringLiteralLike } from '../../../../../src/bmsx/language/ts/ast/literals';
import { isBooleanProducingOperator, isEqualityOperator, isPositiveEqualityOperator } from '../../../../../src/bmsx/language/ts/ast/operators';
import { isExpressionInScopeFingerprint } from './bindings';
import { isFunctionLikeWithParameters } from '../../../../../src/bmsx/language/ts/ast/functions';
import { ExplicitValueCheck } from './types';

export type SingleLiteralComparison<T> = {
	subject: string;
	literal: T;
	operatorKind: ts.SyntaxKind;
};

export function isLikelyBooleanName(name: string): boolean {
	return /^(is|has|can|should|would|could|did|does|will|was|were|needs|uses)[A-Z_]/.test(name)
		|| /(Active|Available|Blocked|Checked|Closed|Dirty|Disabled|Done|Empty|Enabled|Handled|Invalid|Loaded|Ok|OK|Open|Pending|Ready|Rejected|Selected|Success|Valid|Visible)$/.test(name)
		|| /^(active|available|blocked|checked|closed|dirty|disabled|done|empty|enabled|handled|invalid|loaded|ok|open|pending|ready|rejected|selected|success|valid|visible)$/.test(name);
}

export function isLikelyBooleanExpression(node: ts.Expression): boolean {
	const expression = unwrapExpression(node);
	if (ts.isIdentifier(expression)) {
		return isLikelyBooleanName(expression.text);
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return isLikelyBooleanName(expression.name.text);
	}
	if (ts.isCallExpression(expression)) {
		const target = expression.expression;
		if (ts.isIdentifier(target)) {
			return isLikelyBooleanName(target.text);
		}
		if (ts.isPropertyAccessExpression(target)) {
			return isLikelyBooleanName(target.name.text);
		}
		return false;
	}
	if (ts.isPrefixUnaryExpression(expression)) {
		return expression.operator === ts.SyntaxKind.ExclamationToken;
	}
	if (ts.isBinaryExpression(expression)) {
		return isBooleanProducingOperator(expression.operatorToken.kind)
			|| expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
			|| expression.operatorToken.kind === ts.SyntaxKind.BarBarToken;
	}
	return false;
}

export function isBooleanLiteralComparisonSmell(node: ts.BinaryExpression, leftBoolean: boolean | null, rightBoolean: boolean | null): boolean {
	const booleanValue = leftBoolean !== null ? leftBoolean : rightBoolean;
	if (booleanValue !== false) {
		return true;
	}
	const subject = leftBoolean !== null ? node.right : node.left;
	return isLikelyBooleanExpression(subject);
}

export function isEmptyContainerLiteral(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return (ts.isArrayLiteralExpression(unwrapped) && unwrapped.elements.length === 0)
		|| (ts.isObjectLiteralExpression(unwrapped) && unwrapped.properties.length === 0);
}

export function isTypeofFunctionComparison(node: ts.BinaryExpression): boolean {
	if (!isEqualityOperator(node.operatorToken.kind)) {
		return false;
	}
	const left = unwrapExpression(node.left);
	const right = unwrapExpression(node.right);
	return (
		ts.isTypeOfExpression(left)
		&& ts.isStringLiteralLike(right)
		&& right.text === 'function'
	) || (
		ts.isTypeOfExpression(right)
		&& ts.isStringLiteralLike(left)
		&& left.text === 'function'
	);
}

export function collectStringOrChainSubjects(node: ts.Expression, subjects: string[]): boolean {
	if (ts.isParenthesizedExpression(node)) {
		return collectStringOrChainSubjects(node.expression, subjects);
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		return collectStringOrChainSubjects(node.left, subjects) && collectStringOrChainSubjects(node.right, subjects);
	}
	if (!ts.isBinaryExpression(node) || !isEqualityOperator(node.operatorToken.kind)) {
		return false;
	}
	if (!ts.isStringLiteral(node.left) && !ts.isStringLiteral(node.right)) {
		return false;
	}
	if (ts.isStringLiteral(node.left) && ts.isStringLiteral(node.right)) {
		return false;
	}
	const subject = ts.isStringLiteral(node.left) ? node.right : node.left;
	const subjectKey = isExpressionInScopeFingerprint(subject);
	if (subjectKey === null) {
		return false;
	}
	subjects.push(subjectKey);
	return true;
}

export function stringSwitchComparisonSubject(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped) || unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
		return null;
	}
	const leftIsString = isStringLiteralLike(unwrapped.left);
	const rightIsString = isStringLiteralLike(unwrapped.right);
	if (leftIsString === rightIsString) {
		return null;
	}
	const subject = leftIsString ? unwrapped.right : unwrapped.left;
	return isExpressionInScopeFingerprint(subject);
}

export function singleLiteralComparison<T>(
	node: ts.Expression,
	literalValue: (expression: ts.Expression) => T | null,
): SingleLiteralComparison<T> | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped)) {
		return null;
	}
	const operatorKind = unwrapped.operatorToken.kind;
	if (!isEqualityOperator(operatorKind)) {
		return null;
	}
	const leftLiteral = literalValue(unwrapped.left);
	const rightLiteral = literalValue(unwrapped.right);
	if ((leftLiteral !== null) === (rightLiteral !== null)) {
		return null;
	}
	const subject = isExpressionInScopeFingerprint(leftLiteral !== null ? unwrapped.right : unwrapped.left);
	if (subject === null) {
		return null;
	}
	const literal = leftLiteral !== null ? leftLiteral : rightLiteral;
	if (literal === null) {
		return null;
	}
	return {
		subject,
		literal,
		operatorKind,
	};
}

export function falseLiteralComparison(node: ts.Expression): ExplicitValueCheck | null {
	const comparison = singleLiteralComparison(node, isBooleanLiteral);
	if (comparison === null || comparison.literal) {
		return null;
	}
	return {
		subject: comparison.subject,
		isPositive: isPositiveEqualityOperator(comparison.operatorKind),
	};
}

export function isLookupFallbackExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (ts.isElementAccessExpression(unwrapped)) {
		return true;
	}
	if (!ts.isCallExpression(unwrapped)) {
		return false;
	}
	const target = unwrapExpression(unwrapped.expression);
	return ts.isPropertyAccessExpression(target) && target.name.text === 'get';
}

export function isSharedConstantFallbackExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isIdentifier(unwrapped) && /^[A-Z][A-Z0-9_]*$/.test(unwrapped.text);
}

export function isOptionalParameterFallback(node: ts.BinaryExpression): boolean {
	const left = unwrapExpression(node.left);
	if (!ts.isIdentifier(left)) {
		return false;
	}
	let current: ts.Node | undefined = node.parent;
	while (current !== undefined) {
		if (isFunctionLikeWithParameters(current)) {
			for (let index = 0; index < current.parameters.length; index += 1) {
				const parameter = current.parameters[index];
				if (ts.isIdentifier(parameter.name) && parameter.name.text === left.text) {
					return parameter.questionToken !== undefined || parameter.initializer !== undefined;
				}
			}
		}
		current = current.parent;
	}
	return false;
}
