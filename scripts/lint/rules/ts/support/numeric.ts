import ts from 'typescript';
import { unwrapExpression } from './ast';
import { hasPrivateOrProtectedModifier } from './runtime_patterns';

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
