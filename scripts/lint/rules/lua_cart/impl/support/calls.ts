import { type LuaCallExpression, type LuaExpression, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getCallMethodName } from '../../../../../../src/bmsx/lua/syntax/calls';
import { BUILTIN_GLOBAL_FUNCTIONS, BUILTIN_TABLE_NAMES } from './general';

export function isBuiltinCallExpression(expression: LuaCallExpression): boolean {
	if (expression.methodName && expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return BUILTIN_TABLE_NAMES.has(expression.callee.name);
	}
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return BUILTIN_GLOBAL_FUNCTIONS.has(expression.callee.name);
	}
	if (expression.callee.kind !== LuaSyntaxKind.MemberExpression) {
		return false;
	}
	if (expression.callee.base.kind !== LuaSyntaxKind.IdentifierExpression) {
		return false;
	}
	return BUILTIN_TABLE_NAMES.has(expression.callee.base.name);
}

export function isDispatchStateEventCallExpression(expression: LuaCallExpression): boolean {
	return getCallMethodName(expression) === 'dispatch_state_event';
}

export function isGetSpaceCallExpression(expression: LuaExpression | null): boolean {
	if (!expression || expression.kind !== LuaSyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.callee.name === 'get_space'
		&& expression.arguments.length === 0;
}

export function isDirectActionTriggeredCallExpression(expression: LuaExpression): expression is LuaCallExpression {
	return expression.kind === LuaSyntaxKind.CallExpression
		&& expression.callee.kind === LuaSyntaxKind.IdentifierExpression
		&& expression.callee.name === 'action_triggered';
}
