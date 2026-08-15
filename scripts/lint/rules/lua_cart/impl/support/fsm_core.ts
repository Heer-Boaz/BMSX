import { type LuaCallExpression as CallExpression, type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintFsmDirectStateHandlerMapValue } from '../../fsm_direct_state_handler_shorthand_pattern';
import { getCallMethodName, getCallReceiverExpression } from '../../../../../../toolchain/ts/lua/syntax/calls';
import { FSM_STATE_HANDLER_MAP_KEYS } from './fsm_transitions';
import { isSelfExpressionRoot } from './self_properties';
import { getTableFieldKey } from './table_fields';
import { CART_MODULE_CALL_FSM_REGISTER, type CartModuleCallKind } from './types';

export function isStateControllerExpression(expression: Expression): boolean {
	if (expression.kind === SyntaxKind.IdentifierExpression) {
		return expression.name === 'sc';
	}
	if (expression.kind === SyntaxKind.MemberExpression) {
		return expression.identifier === 'sc';
	}
	if (expression.kind !== SyntaxKind.IndexExpression) {
		return false;
	}
	if (expression.index.kind === SyntaxKind.StringLiteralExpression) {
		return expression.index.value === 'sc';
	}
	if (expression.index.kind === SyntaxKind.IdentifierExpression) {
		return expression.index.name === 'sc';
	}
	return false;
}

export function isStateControllerDispatchCallExpression(expression: CallExpression): boolean {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'dispatch') {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!receiver) {
		return false;
	}
	return isStateControllerExpression(receiver);
}

export function isTickInputCheckCallExpression(expression: CallExpression): boolean {
	if (expression.callee.kind === SyntaxKind.IdentifierExpression) {
		if (isActionInputCallName(expression.callee.name.toLowerCase())) {
			return true;
		}
	}
	const methodName = getCallMethodName(expression);
	if (!methodName) {
		return false;
	}
	const loweredMethodName = methodName.toLowerCase();
	if (!/(?:pressed|held|triggered|input)/.test(loweredMethodName)) {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	return !!receiver && isSelfExpressionRoot(receiver);
}

function isActionInputCallName(name: string): boolean {
	switch (name) {
		case 'action_triggered':
		case 'action_pressed':
		case 'action_released':
		case 'action_held':
			return true;
		default:
			return false;
	}
}

export function lintFsmDirectStateHandlerShorthandPatternInTable(
	expression: Expression,
	issues: CartLintIssue[],
): void {
	if (expression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_STATE_HANDLER_MAP_KEYS.has(key)) {
			lintFsmDirectStateHandlerMapValue(field.value, issues);
		}
		if (field.kind === TableFieldKind.ExpressionKey) {
			lintFsmDirectStateHandlerShorthandPatternInTable(field.key, issues);
		}
		lintFsmDirectStateHandlerShorthandPatternInTable(field.value, issues);
	}
}

export function lintFsmDirectStateHandlerShorthandPattern(
	expression: CallExpression,
	callKind: CartModuleCallKind | undefined,
	issues: CartLintIssue[],
): void {
	if (callKind !== CART_MODULE_CALL_FSM_REGISTER) {
		return;
	}
	const definition = expression.arguments[1];
	if (!definition) {
		return;
	}
	lintFsmDirectStateHandlerShorthandPatternInTable(definition, issues);
}

export const FSM_DELEGATE_HANDLER_KEYS = new Set<string>([
	'entering_state',
	'exiting_state',
	'update',
]);
