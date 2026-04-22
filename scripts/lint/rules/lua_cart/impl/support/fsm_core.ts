import { type LuaCallExpression, type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintFsmDirectStateHandlerMapValue } from '../../fsm_direct_state_handler_shorthand_pattern';
import { getCallMethodName, getCallReceiverExpression, isGlobalCall } from './calls';
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
		const calleeName = expression.callee.name.toLowerCase();
		if (calleeName === 'action_triggered'
			|| calleeName === 'action_pressed'
			|| calleeName === 'action_released'
			|| calleeName === 'action_held') {
			return true;
		}
	}
	const methodName = getCallMethodName(expression);
	if (!methodName) {
		return false;
	}
	const loweredMethodName = methodName.toLowerCase();
	if (!loweredMethodName.includes('pressed')
		&& !loweredMethodName.includes('held')
		&& !loweredMethodName.includes('triggered')
		&& !loweredMethodName.includes('input')) {
		return false;
	}
	const receiver = getCallReceiverExpression(expression);
	return !!receiver && isSelfExpressionRoot(receiver);
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
