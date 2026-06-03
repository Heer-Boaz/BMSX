import ts from 'typescript';
import { unwrapExpression } from './expressions';

export function isBooleanLiteral(node: ts.Expression): boolean | null {
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}
	return null;
}

export function isEmptyStringLiteral(node: ts.Expression): node is ts.StringLiteral {
	return ts.isStringLiteral(node) && node.text.length === 0;
}

export function isStringLiteralLike(node: ts.Expression): boolean {
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

export function nullishLiteralKind(node: ts.Expression): 'null' | 'undefined' | null {
	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return 'null';
	}
	if (ts.isIdentifier(node) && node.text === 'undefined') {
		return 'undefined';
	}
	return null;
}

export function isNullOrUndefined(node: ts.Expression): boolean {
	return nullishLiteralKind(node) !== null;
}

export function isNumericLiteralText(node: ts.Expression, value: string): boolean {
	const expression = unwrapExpression(node);
	return ts.isNumericLiteral(expression) && expression.text === value;
}

export function isNumericLiteralLike(node: ts.Expression): boolean {
	const expression = unwrapExpression(node);
	if (ts.isNumericLiteral(expression)) {
		return true;
	}
	if (ts.isPrefixUnaryExpression(expression) && (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken)) {
		return ts.isNumericLiteral(unwrapExpression(expression.operand));
	}
	return false;
}
