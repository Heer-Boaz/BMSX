import { defineLintRule } from '../../rule';
import { type LuaFunctionExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { hasTransitionReturnInStatements } from './impl/support/fsm_transitions';
import { isEventProxyFlagPropertyName } from './impl/support/general';
import { getSelfPropertyNameFromConditionExpression, hasSelfPropertyResetInStatements } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const tickFlagPollingPatternRule = defineLintRule('lua_cart', 'tick_flag_polling_pattern');

export function lintTickFlagPollingPattern(functionExpression: LuaFunctionExpression, issues: LuaLintIssue[]): void {
	for (const statement of functionExpression.body.body) {
		if (statement.kind !== LuaSyntaxKind.IfStatement) {
			continue;
		}
		for (const clause of statement.clauses) {
			const propertyName = getSelfPropertyNameFromConditionExpression(clause.condition);
			if (!propertyName) {
				continue;
			}
			const hasReset = hasSelfPropertyResetInStatements(clause.block.body, propertyName);
			if (!hasReset) {
				continue;
			}
			const hasTransitionReturn = hasTransitionReturnInStatements(clause.block.body);
			if (!hasTransitionReturn && !isEventProxyFlagPropertyName(propertyName)) {
				continue;
			}
			pushIssue(
				issues,
				tickFlagPollingPatternRule.name,
				clause.condition ?? statement,
				hasTransitionReturn
					? `Delayed event-proxy transition via self.${propertyName} in tick is forbidden. Handle the transition directly via FSM events/on maps, input handlers, process_input, or timelines instead of flag polling + reset + return.`
					: `Tick polling on self.${propertyName} is forbidden. Use FSM events/timelines/input handlers for transitions instead of tick-flag polling and manual resets.`,
			);
		}
	}
}
