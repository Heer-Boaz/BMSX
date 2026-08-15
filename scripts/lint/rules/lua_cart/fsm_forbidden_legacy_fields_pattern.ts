import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmForbiddenLegacyFieldsPatternRule = defineLintRule('cart', 'fsm_forbidden_legacy_fields_pattern');

const forbiddenFsmLegacyFieldReplacements: Readonly<Record<string, string>> = {
	leaving_state: 'Use "exiting_state".',
	derived_tags: 'Use "tag_derivations".',
	tag_groups: 'Use "tag_derivations".',
	tick: 'Use state "update".',
	process_input: 'Use "input_event_handlers".',
	run_checks: 'Use "input_event_handlers".',
	on_frame: 'Use timeline definition "apply" or a value/sample track.',
	on_end: 'Use timeline binding "on_finished" for terminal completion.',
};

export function lintFsmForbiddenLegacyFieldsInTable(expression: Expression, issues: CartLintIssue[]): void {
	if (expression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of expression.fields) {
		const key = getTableFieldKey(field);
		const replacement = key && forbiddenFsmLegacyFieldReplacements[key];
		if (replacement) {
			pushIssue(
				issues,
				fsmForbiddenLegacyFieldsPatternRule.name,
				field.value,
				`FSM field "${key}" is forbidden. ${replacement}`,
			);
		}
		if (field.kind === TableFieldKind.ExpressionKey) {
			lintFsmForbiddenLegacyFieldsInTable(field.key, issues);
		}
		lintFsmForbiddenLegacyFieldsInTable(field.value, issues);
	}
}
