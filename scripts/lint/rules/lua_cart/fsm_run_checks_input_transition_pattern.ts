import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { findCallExpressionInStatements } from '../../../../src/bmsx/lua/syntax/calls';
import { isTickInputCheckCallExpression } from './impl/support/fsm_core';
import { hasTransitionReturnInStatements } from './impl/support/fsm_transitions';
import { getRunCheckGoFunction } from './impl/support/functions';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmRunChecksInputTransitionPatternRule = defineLintRule('cart', 'fsm_run_checks_input_transition_pattern');

export function lintFsmRunChecksInputTransitionPatternInTable(expression: Expression, issues: CartLintIssue[]): void {
	if (expression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key === 'run_checks' && field.value.kind === SyntaxKind.TableConstructorExpression) {
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
		if (field.kind === TableFieldKind.ExpressionKey) {
			lintFsmRunChecksInputTransitionPatternInTable(field.key, issues);
		}
		lintFsmRunChecksInputTransitionPatternInTable(field.value, issues);
	}
}
