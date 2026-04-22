import { type LuaCallExpression as CallExpression, type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getCallMethodName } from '../../../../../../src/bmsx/lua/syntax/calls';
import { BUILTIN_GLOBAL_FUNCTIONS, BUILTIN_TABLE_NAMES } from './general';

export function isBuiltinCallExpression(expression: CallExpression): boolean {
	if (expression.methodName && expression.callee.kind === SyntaxKind.IdentifierExpression) {
		return BUILTIN_TABLE_NAMES.has(expression.callee.name);
	}
	if (expression.callee.kind === SyntaxKind.IdentifierExpression) {
		return BUILTIN_GLOBAL_FUNCTIONS.has(expression.callee.name);
	}
	if (expression.callee.kind !== SyntaxKind.MemberExpression) {
		return false;
	}
	if (expression.callee.base.kind !== SyntaxKind.IdentifierExpression) {
		return false;
	}
	return BUILTIN_TABLE_NAMES.has(expression.callee.base.name);
}

export function isDispatchStateEventCallExpression(expression: CallExpression): boolean {
	return getCallMethodName(expression) === 'dispatch_state_event';
}

export function isGetSpaceCallExpression(expression: Expression | null): boolean {
	if (!expression || expression.kind !== SyntaxKind.CallExpression) {
		return false;
	}
	return expression.callee.kind === SyntaxKind.IdentifierExpression
		&& expression.callee.name === 'get_space'
		&& expression.arguments.length === 0;
}

export function isDirectActionTriggeredCallExpression(expression: Expression): expression is CallExpression {
	return expression.kind === SyntaxKind.CallExpression
		&& expression.callee.kind === SyntaxKind.IdentifierExpression
		&& expression.callee.name === 'action_triggered';
}
