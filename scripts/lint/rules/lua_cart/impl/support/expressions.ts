import { type LuaExpression, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { isConstantSourceIdentifierName } from './bindings';
import { isConstantModuleRequireExpression } from './require_aliases';
import { ConstantCopyContext } from './types';

export function isConstantSourceExpression(expression: LuaExpression, context: ConstantCopyContext): boolean {
	if (isConstantModuleRequireExpression(expression)) {
		return true;
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return isConstantSourceIdentifierName(expression.name, context);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
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

export function isSimpleCallableExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression
		|| expression.kind === LuaSyntaxKind.MemberExpression
		|| expression.kind === LuaSyntaxKind.IndexExpression;
}

export function isAssignableStorageExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression
		|| expression.kind === LuaSyntaxKind.MemberExpression
		|| expression.kind === LuaSyntaxKind.IndexExpression;
}
