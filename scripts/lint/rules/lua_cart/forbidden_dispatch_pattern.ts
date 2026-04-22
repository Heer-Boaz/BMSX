import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isDispatchStateEventCallExpression } from './impl/support/calls';
import { isStateControllerDispatchCallExpression } from './impl/support/fsm_core';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenDispatchPatternRule = defineLintRule('cart', 'forbidden_dispatch_pattern');

export function lintForbiddenDispatchPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	const dispatchStateEventCall = isDispatchStateEventCallExpression(expression);
	const stateControllerDispatchCall = isStateControllerDispatchCallExpression(expression);
	if (!dispatchStateEventCall && !stateControllerDispatchCall) {
		return;
	}
	pushIssue(
		issues,
		forbiddenDispatchPatternRule.name,
		expression,
		'State dispatch APIs are forbidden in cart code (dispatch_state_event(...) and sc:dispatch(...)). Do not replace one with the other; model transitions directly in FSM definitions (on/input/process_input/timelines).',
	);
}
