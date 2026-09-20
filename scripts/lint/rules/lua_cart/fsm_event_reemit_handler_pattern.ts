import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { getGoFunctionFromHandlerEntryValue, isSelfEventsEmitCallExpression } from './impl/support/fsm_events';
import { pushIssue } from './impl/support/lint_context';

export const fsmEventReemitHandlerPatternRule = defineLintRule('cart', 'fsm_event_reemit_handler_pattern');

export function lintFsmEventReemitHandlerPatternInMap(mapExpression: Expression, lint: CartLintContext): void {
	if (mapExpression.kind !== SyntaxKind.TableConstructorExpression) {
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
		const onlyStatement = goFunction.body.body.get(0);
		if (onlyStatement.kind !== SyntaxKind.CallStatement) {
			continue;
		}
		if (!isSelfEventsEmitCallExpression(onlyStatement.expression)) {
			continue;
		}
		pushIssue(
			lint,
			fsmEventReemitHandlerPatternRule.name,
			onlyStatement.expression,
			'FSM event handler that only re-emits another event is forbidden. Model the transition directly in FSM maps instead of event->event relay handlers.',
		);
	}
}
