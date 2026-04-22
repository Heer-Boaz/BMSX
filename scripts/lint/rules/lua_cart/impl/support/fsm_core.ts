import { type LuaCallExpression, type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintFsmDirectStateHandlerMapValue } from '../../fsm_direct_state_handler_shorthand_pattern';
import { getCallMethodName, getCallReceiverExpression, isGlobalCall } from '../../../../../../src/bmsx/lua/syntax/calls';
import { FSM_STATE_HANDLER_MAP_KEYS } from './fsm_transitions';
import { isSelfExpressionRoot } from './self_properties';
import { getTableFieldKey } from './table_fields';

export function isStateControllerExpression(expression: LuaExpression): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === 'sc';
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expression.identifier === 'sc';
	}
	if (expression.kind !== LuaSyntaxKind.IndexExpression) {
		return false;
	}
	if (expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		return expression.index.value === 'sc';
	}
	if (expression.index.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.index.name === 'sc';
	}
	return false;
}

export function isStateControllerDispatchCallExpression(expression: LuaCallExpression): boolean {
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

export function isTickInputCheckCallExpression(expression: LuaCallExpression): boolean {
	if (expression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
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
	expression: LuaExpression,
	issues: LuaLintIssue[],
): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FSM_STATE_HANDLER_MAP_KEYS.has(key)) {
			lintFsmDirectStateHandlerMapValue(field.value, issues);
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmDirectStateHandlerShorthandPatternInTable(field.key, issues);
		}
		lintFsmDirectStateHandlerShorthandPatternInTable(field.value, issues);
	}
}

export function lintFsmDirectStateHandlerShorthandPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
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
	'leaving_state',
	'tick',
	'process_input',
]);
