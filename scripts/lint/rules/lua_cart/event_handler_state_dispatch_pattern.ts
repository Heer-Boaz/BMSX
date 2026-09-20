import type { LuaStatementSequence } from '../../../../toolchain/ts/lua/syntax/statement_sequence';
import { defineLintRule } from '../../rule';
import { type CartLintContext } from '../../lua_rule';
import { findCallExpressionInStatements } from '../../../../toolchain/ts/lua/syntax/calls';
import { isCrossObjectDispatchStateEventCallExpression } from './impl/support/object_ownership';
import { pushIssue } from './impl/support/lint_context';

export const eventHandlerStateDispatchPatternRule = defineLintRule('cart', 'event_handler_state_dispatch_pattern');

export function lintEventHandlerStateDispatchPattern(statements: LuaStatementSequence, lint: CartLintContext): void {
	const expression = findCallExpressionInStatements(statements, isCrossObjectDispatchStateEventCallExpression);
	if (!expression) {
		return;
	}
	pushIssue(
		lint,
		eventHandlerStateDispatchPatternRule.name,
		expression,
		'Event handler callbacks must not dispatch_state_event(...) on other objects/services. Keep transitions owned by each object/service FSM.',
	);
}
