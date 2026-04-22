import { type LuaCallExpression, type LuaExpression, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getCallReceiverExpression } from '../../../../../../src/bmsx/lua/syntax/calls';
import { isDispatchStateEventCallExpression } from './calls';
import { isSelfExpressionRoot } from './self_properties';

export function isConstantModulePath(path: string): boolean {
	return path === 'constants' || path === 'globals' || path.endsWith('/constants') || path.endsWith('/globals');
}

export function isCrossObjectDispatchStateEventCallExpression(expression: LuaCallExpression): boolean {
	if (!isDispatchStateEventCallExpression(expression)) {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return true;
	}
	return !isSelfExpressionRoot(receiver);
}

export function isObjectOrServiceResolverCallExpression(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& (expression.callee.name === 'object' || expression.callee.name === 'service');
}

export function isServiceResolverCallExpression(expression: LuaExpression | undefined): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.callee.name === 'service';
}

export function isModuleFieldAssignmentTarget(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.base.kind === LuaSyntaxKind.IdentifierExpression;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return expression.base.kind === LuaSyntaxKind.IdentifierExpression;
	}
	return false;
}

export function getModuleFieldAssignmentBaseIdentifier(expression: LuaExpression): string | undefined {
	if (expression.kind === LuaSyntaxKind.MemberExpression && expression.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.base.name;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression && expression.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.base.name;
	}
	return undefined;
}
