import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findTickCounterMutationInStatements, hasTransitionReturnInStatements } from './impl/support/fsm_transitions';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmTickCounterTransitionPatternRule = defineLintRule('lua_cart', 'fsm_tick_counter_transition_pattern');

export function lintFsmTickCounterTransitionPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'tick' && field.value.kind === LuaSyntaxKind.FunctionExpression) {
			const body = field.value.body.body;
			if (hasTransitionReturnInStatements(body)) {
				const mutation = findTickCounterMutationInStatements(body);
				if (mutation) {
					pushIssue(
						issues,
						fsmTickCounterTransitionPatternRule.name,
						mutation,
						'Tick-based countdown/countup transition pattern is forbidden. Model timed transitions with FSM timelines and timeline events instead of mutating self counters in tick.',
					);
				}
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmTickCounterTransitionPatternInTable(field.key, issues);
		}
		lintFsmTickCounterTransitionPatternInTable(field.value, issues);
	}
}
