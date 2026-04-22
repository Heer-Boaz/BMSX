import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { FORBIDDEN_FSM_LEGACY_FIELDS } from './impl/support/fsm_transitions';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmForbiddenLegacyFieldsPatternRule = defineLintRule('cart', 'fsm_forbidden_legacy_fields_pattern');

export function lintFsmForbiddenLegacyFieldsInTable(expression: Expression, issues: CartLintIssue[]): void {
	if (expression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		if (key && FORBIDDEN_FSM_LEGACY_FIELDS.has(key)) {
			pushIssue(
				issues,
				fsmForbiddenLegacyFieldsPatternRule.name,
				field.value,
				`FSM field "${key}" is forbidden. Use state "update" and "input_event_handlers" only.`,
			);
		}
		if (field.kind === TableFieldKind.ExpressionKey) {
			lintFsmForbiddenLegacyFieldsInTable(field.key, issues);
		}
		lintFsmForbiddenLegacyFieldsInTable(field.value, issues);
	}
}
