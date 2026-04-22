import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getGoFunctionFromHandlerEntryValue, isSelfEventsEmitCallExpression } from './impl/support/fsm_events';
import { pushIssue } from './impl/support/lint_context';

export const fsmEventReemitHandlerPatternRule = defineLintRule('lua_cart', 'fsm_event_reemit_handler_pattern');

export function lintFsmEventReemitHandlerPatternInMap(mapExpression: LuaExpression, issues: LuaLintIssue[]): void {
	if (mapExpression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const entry of mapExpression.fields) {
		const goFunction = getGoFunctionFromHandlerEntryValue(entry.value);
		if (!goFunction) {
			continue;
		}
		if (goFunction.body.body.length !== 1) {
			continue;
		}
		const onlyStatement = goFunction.body.body[0];
		if (onlyStatement.kind !== LuaSyntaxKind.CallStatement) {
			continue;
		}
		if (!isSelfEventsEmitCallExpression(onlyStatement.expression)) {
			continue;
		}
		pushIssue(
			issues,
			fsmEventReemitHandlerPatternRule.name,
			onlyStatement.expression,
			'FSM event handler that only re-emits another event is forbidden. Model the transition directly in FSM maps instead of event->event relay handlers.',
		);
	}
}
