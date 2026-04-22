import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { lintEventHandlerFlagProxyPattern } from './event_handler_flag_proxy_pattern';
import { lintEventHandlerStateDispatchPattern } from './event_handler_state_dispatch_pattern';
import { forbiddenDispatchPatternRule } from './forbidden_dispatch_pattern';
import { findCallExpressionInStatements } from './impl/support/calls';
import { isStateControllerDispatchCallExpression } from './impl/support/fsm_core';
import { isEventsOnCallExpression } from './impl/support/fsm_events';
import { isEventProxyFlagPropertyName } from './impl/support/general';
import { isCrossObjectDispatchStateEventCallExpression } from './impl/support/object_ownership';
import { findSelfPropertyAssignmentInStatements } from './impl/support/self_properties';
import { findTableFieldByKey } from './impl/support/table_fields';
import { activeLintRules, pushIssue } from './impl/support/lint_context';

export const eventHandlerDispatchPatternRule = defineLintRule('lua_cart', 'event_handler_dispatch_pattern');

export function lintEventHandlerDispatchPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isEventsOnCallExpression(expression)) {
		return;
	}
	const globalDispatchBan = activeLintRules.has(forbiddenDispatchPatternRule.name);
	for (const argument of expression.arguments) {
		const handlerField = findTableFieldByKey(argument, 'handler');
		if (!handlerField || handlerField.value.kind !== LuaSyntaxKind.FunctionExpression) {
			continue;
		}
		if (!globalDispatchBan) {
			const scDispatchCall = findCallExpressionInStatements(
				handlerField.value.body.body,
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
			const crossObjectStateDispatchCall = findCallExpressionInStatements(
				handlerField.value.body.body,
				isCrossObjectDispatchStateEventCallExpression,
			);
			if (crossObjectStateDispatchCall) {
				lintEventHandlerStateDispatchPattern(crossObjectStateDispatchCall, issues);
			}
		}
		const proxyFlagAssignment = findSelfPropertyAssignmentInStatements(
			handlerField.value.body.body,
			isEventProxyFlagPropertyName,
		);
		if (proxyFlagAssignment) {
			lintEventHandlerFlagProxyPattern(proxyFlagAssignment, issues);
		}
	}
}
