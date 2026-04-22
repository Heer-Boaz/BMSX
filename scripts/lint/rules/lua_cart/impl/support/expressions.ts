import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isConstantSourceIdentifierName } from './bindings';
import { isConstantModuleRequireExpression } from './require_aliases';
import { ConstantCopyContext } from './types';

export function isConstantSourceExpression(expression: Expression, context: ConstantCopyContext): boolean {
	if (isConstantModuleRequireExpression(expression)) {
		return true;
	}
	return isConstantBindingPathExpression(expression, context);
}

export function isConstantBindingPathExpression(expression: Expression, context: ConstantCopyContext): boolean {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return isConstantSourceIdentifierName(expression.name, context);
	}
	if (expression.kind === SyntaxKind.MemberExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	if (expression.kind === SyntaxKind.IndexExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	return false;
}

export function getRangeLineSpan(node: { readonly range: { readonly start: { readonly line: number; }; readonly end: { readonly line: number; }; }; }): number {
	const lineSpan = node.range.end.line - node.range.start.line + 1;
	if (lineSpan <= 0) {
		return 1;
	}
	return lineSpan;
}

export function isSimpleCallableExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.IdentifierExpression
		|| expression.kind === SyntaxKind.MemberExpression
		|| expression.kind === SyntaxKind.IndexExpression;
}

export function isAssignableStorageExpression(expression: Expression): boolean {
	return expression.kind === SyntaxKind.IdentifierExpression
		|| expression.kind === SyntaxKind.MemberExpression
		|| expression.kind === SyntaxKind.IndexExpression;
}
