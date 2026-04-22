import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { lintEventHandlerFlagProxyPattern } from './event_handler_flag_proxy_pattern';
import { lintEventHandlerStateDispatchPattern } from './event_handler_state_dispatch_pattern';
import { forbiddenDispatchPatternRule } from './forbidden_dispatch_pattern';
import { findCallExpressionInStatements } from '../../../../src/bmsx/lua/syntax/calls';
import { isStateControllerDispatchCallExpression } from './impl/support/fsm_core';
import { isEventsOnCallExpression } from './impl/support/fsm_events';
import { findTableFieldByKey } from './impl/support/table_fields';
import { activeLintRules, pushIssue } from './impl/support/lint_context';

export const eventHandlerDispatchPatternRule = defineLintRule('cart', 'event_handler_dispatch_pattern');

export function lintEventHandlerDispatchPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isEventsOnCallExpression(expression)) {
		return;
	}
	const globalDispatchBan = activeLintRules.has(forbiddenDispatchPatternRule.name);
	for (const argument of expression.arguments) {
		const handlerField = findTableFieldByKey(argument, 'handler');
		if (!handlerField || handlerField.value.kind !== SyntaxKind.FunctionExpression) {
			continue;
		}
		const handlerBody = handlerField.value.body.body;
		if (!globalDispatchBan) {
			const scDispatchCall = findCallExpressionInStatements(
				handlerBody,
				isStateControllerDispatchCallExpression,
			);
			if (scDispatchCall) {
				pushIssue(
					issues,
					eventHandlerDispatchPatternRule.name,
					scDispatchCall,
					'Event handler callbacks must not call sc:dispatch(...). Route event-driven transitions via FSM definitions instead of manual dispatch inside events:on handlers.',
				);
			}
			lintEventHandlerStateDispatchPattern(handlerBody, issues);
		}
		lintEventHandlerFlagProxyPattern(handlerBody, issues);
	}
}
