import { type LuaCallExpression as CallExpression, type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getCallReceiverExpression } from '../../../../../../src/bmsx/lua/syntax/calls';
import { isIdentifierExpression } from './bindings';
import { isDispatchStateEventCallExpression } from './calls';
import { isSelfExpressionRoot } from './self_properties';

export function isConstantModulePath(path: string): boolean {
	return path === 'constants' || path === 'globals' || path.endsWith('/constants') || path.endsWith('/globals');
}

export function isCrossObjectDispatchStateEventCallExpression(expression: CallExpression): boolean {
	if (!isDispatchStateEventCallExpression(expression)) {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return true;
	}
	return !isSelfExpressionRoot(receiver);
}

export function isObjectOrServiceResolverCallExpression(expression: Expression | undefined): boolean {
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === SyntaxKind.IdentifierExpression
		&& (expression.callee.name === 'object' || expression.callee.name === 'service');
}

export function isServiceResolverCallExpression(expression: Expression | undefined): boolean {
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === SyntaxKind.IdentifierExpression
		&& expression.callee.name === 'service';
}

export function isModuleFieldAssignmentTarget(expression: Expression): boolean {
	if (expression.kind === SyntaxKind.MemberExpression) {
		return isIdentifierExpression(expression.base);
	}
	if (expression.kind === SyntaxKind.IndexExpression) {
		return isIdentifierExpression(expression.base);
	}
	return false;
}

export function getModuleFieldAssignmentBaseIdentifier(expression: Expression): string | undefined {
	if (expression.kind === SyntaxKind.MemberExpression && expression.base.kind === SyntaxKind.IdentifierExpression) {
		return expression.base.name;
	}
	if (expression.kind === SyntaxKind.IndexExpression && expression.base.kind === SyntaxKind.IdentifierExpression) {
		return expression.base.name;
	}
	return undefined;
}
