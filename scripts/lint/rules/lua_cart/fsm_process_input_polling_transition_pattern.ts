import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements } from '../../../../src/bmsx/lua/syntax/calls';
import { isTickInputCheckCallExpression } from './impl/support/fsm_core';
import { hasTransitionReturnInStatements } from './impl/support/fsm_transitions';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmProcessInputPollingTransitionPatternRule = defineLintRule('lua_cart', 'fsm_process_input_polling_transition_pattern');

export function lintFsmProcessInputPollingTransitionPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'process_input' && field.value.kind === LuaSyntaxKind.FunctionExpression) {
			const inputCheck = findCallExpressionInStatements(field.value.body.body, isTickInputCheckCallExpression);
			if (inputCheck && hasTransitionReturnInStatements(field.value.body.body)) {
				pushIssue(
					issues,
					fsmProcessInputPollingTransitionPatternRule.name,
					inputCheck,
					'FSM process_input polling that drives state transitions is forbidden. Use input_event_handlers with direct state-id mappings instead of action_triggered checks in process_input.',
				);
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmProcessInputPollingTransitionPatternInTable(field.key, issues);
		}
		lintFsmProcessInputPollingTransitionPatternInTable(field.value, issues);
	}
}
