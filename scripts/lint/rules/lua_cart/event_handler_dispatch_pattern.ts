import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { eventHandlerFlagProxyPatternRule } from './event_handler_flag_proxy_pattern';
import { eventHandlerStateDispatchPatternRule } from './event_handler_state_dispatch_pattern';
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
				pushIssue(
					issues,
					eventHandlerStateDispatchPatternRule.name,
					crossObjectStateDispatchCall,
						'Event handler callbacks must not dispatch_state_event(...) on other objects/services. Keep transitions owned by each object/service FSM.',
					);
				}
		}
				const proxyFlagAssignment = findSelfPropertyAssignmentInStatements(
					handlerField.value.body.body,
					isEventProxyFlagPropertyName,
				);
			if (proxyFlagAssignment) {
				pushIssue(
					issues,
					eventHandlerFlagProxyPatternRule.name,
					proxyFlagAssignment.target,
					`Event handler flag-proxy pattern is forbidden (self.${proxyFlagAssignment.propertyName}). Do not stage FSM transitions through *_requested/*_pending/*_done flags; use FSM events/timelines/input handlers directly.`,
				);
			}
		}
}
