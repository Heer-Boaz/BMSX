import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { forbiddenDispatchPatternRule } from './forbidden_dispatch_pattern';
import { getCallReceiverExpression } from '../../../../src/bmsx/lua/syntax/calls';
import { isCrossObjectDispatchStateEventCallExpression, isObjectOrServiceResolverCallExpression } from './impl/support/object_ownership';
import { activeLintRules, pushIssue } from './impl/support/lint_context';

export const crossObjectStateEventRelayPatternRule = defineLintRule('lua_cart', 'cross_object_state_event_relay_pattern');

const CROSS_OBJECT_STATE_EVENT_RELAY_MESSAGE =
	'Cross-object dispatch_state_event relay with dynamic event names is forbidden. Keep event ownership local and model transitions via FSM events/on maps.';

export function lintCrossObjectStateEventRelayPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (activeLintRules.has(forbiddenDispatchPatternRule.name)) {
		return;
	}
	if (!isCrossObjectDispatchStateEventCallExpression(expression)) {
		return;
	}
	if (expression.arguments.length === 0 || expression.arguments[0].kind !== LuaSyntaxKind.IdentifierExpression) {
		return;
	}
	const receiver = getCallReceiverExpression(expression);
	if (!isObjectOrServiceResolverCallExpression(receiver)) {
		return;
	}
	pushIssue(
		issues,
		crossObjectStateEventRelayPatternRule.name,
		expression,
		CROSS_OBJECT_STATE_EVENT_RELAY_MESSAGE,
	);
}
