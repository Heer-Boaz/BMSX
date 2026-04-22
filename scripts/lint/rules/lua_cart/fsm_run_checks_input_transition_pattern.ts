import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements } from './impl/support/calls';
import { isTickInputCheckCallExpression } from './impl/support/fsm_core';
import { hasTransitionReturnInStatements } from './impl/support/fsm_transitions';
import { getRunCheckGoFunction } from './impl/support/functions';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmRunChecksInputTransitionPatternRule = defineLintRule('lua_cart', 'fsm_run_checks_input_transition_pattern');

export function lintFsmRunChecksInputTransitionPatternInTable(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'run_checks' && field.value.kind === LuaSyntaxKind.TableConstructorExpression) {
			for (const runCheckEntry of field.value.fields) {
				const goFunction = getRunCheckGoFunction(runCheckEntry.value);
				if (!goFunction) {
					continue;
				}
				const inputCheck = findCallExpressionInStatements(goFunction.body.body, isTickInputCheckCallExpression);
				if (!inputCheck) {
					continue;
				}
				if (!hasTransitionReturnInStatements(goFunction.body.body)) {
					continue;
				}
				pushIssue(
					issues,
					fsmRunChecksInputTransitionPatternRule.name,
					inputCheck,
					'FSM run_checks input polling with state-transition return is forbidden. Use input_event_handlers with direct state-id mappings instead of action_triggered checks in run_checks.',
				);
			}
		}
		if (field.kind === LuaTableFieldKind.ExpressionKey) {
			lintFsmRunChecksInputTransitionPatternInTable(field.key, issues);
		}
		lintFsmRunChecksInputTransitionPatternInTable(field.value, issues);
	}
}
