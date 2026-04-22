import { defineLintRule } from '../../rule';
import { type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { pushIssue } from './impl/support/lint_context';

export const eventHandlerStateDispatchPatternRule = defineLintRule('lua_cart', 'event_handler_state_dispatch_pattern');

export function lintEventHandlerStateDispatchPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	pushIssue(
		issues,
		eventHandlerStateDispatchPatternRule.name,
		expression,
		'Event handler callbacks must not dispatch_state_event(...) on other objects/services. Keep transitions owned by each object/service FSM.',
	);
}
