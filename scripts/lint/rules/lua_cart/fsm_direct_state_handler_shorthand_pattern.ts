import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmDirectStateHandlerShorthandPatternRule = defineLintRule('lua_cart', 'fsm_direct_state_handler_shorthand_pattern');

export function lintFsmDirectStateHandlerMapValue(mapExpression: LuaExpression, issues: LuaLintIssue[]): void {
	if (mapExpression.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const entry of mapExpression.fields) {
		const value = entry.value;
		if (value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			continue;
		}
		if (value.fields.length !== 1) {
			continue;
		}
		const goField = findTableFieldByKey(value, 'go');
		if (!goField) {
			continue;
		}
		if (
			goField.value.kind !== LuaSyntaxKind.StringLiteralExpression &&
			goField.value.kind !== LuaSyntaxKind.FunctionExpression &&
			goField.value.kind !== LuaSyntaxKind.IdentifierExpression &&
			goField.value.kind !== LuaSyntaxKind.MemberExpression &&
			goField.value.kind !== LuaSyntaxKind.IndexExpression
		) {
			continue;
		}
		if (goField.value.kind === LuaSyntaxKind.StringLiteralExpression) {
			pushIssue(
				issues,
				fsmDirectStateHandlerShorthandPatternRule.name,
				goField.value,
				`FSM direct state-id handlers must use shorthand. Replace "{ go = '${goField.value.value}' }" with "${goField.value.value}".`,
			);
			continue;
		}
		pushIssue(
			issues,
			fsmDirectStateHandlerShorthandPatternRule.name,
			goField.value,
			'FSM direct handler shorthand is required. Replace "{ go = <handler> }" with "<handler>".',
		);
	}
}
