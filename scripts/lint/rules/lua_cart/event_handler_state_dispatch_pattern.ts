import { defineLintRule } from '../../rule';
import { type LuaStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements } from './impl/support/calls';
import { isCrossObjectDispatchStateEventCallExpression } from './impl/support/object_ownership';
import { pushIssue } from './impl/support/lint_context';

export const eventHandlerStateDispatchPatternRule = defineLintRule('lua_cart', 'event_handler_state_dispatch_pattern');

export function lintEventHandlerStateDispatchPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const expression = findCallExpressionInStatements(statements, isCrossObjectDispatchStateEventCallExpression);
	if (!expression) {
		return;
	}
	pushIssue(
		issues,
		eventHandlerStateDispatchPatternRule.name,
		expression,
		'Event handler callbacks must not dispatch_state_event(...) on other objects/services. Keep transitions owned by each object/service FSM.',
	);
}
