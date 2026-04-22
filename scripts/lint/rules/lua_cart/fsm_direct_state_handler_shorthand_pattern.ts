import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const fsmDirectStateHandlerShorthandPatternRule = defineLintRule('cart', 'fsm_direct_state_handler_shorthand_pattern');

export function lintFsmDirectStateHandlerMapValue(mapExpression: Expression, issues: CartLintIssue[]): void {
	if (mapExpression.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const entry of mapExpression.fields) {
		const value = entry.value;
		if (value.kind !== SyntaxKind.TableConstructorExpression) {
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
			goField.value.kind !== SyntaxKind.StringLiteralExpression &&
			goField.value.kind !== SyntaxKind.FunctionExpression &&
			goField.value.kind !== SyntaxKind.IdentifierExpression &&
			goField.value.kind !== SyntaxKind.MemberExpression &&
			goField.value.kind !== SyntaxKind.IndexExpression
		) {
			continue;
		}
		if (goField.value.kind === SyntaxKind.StringLiteralExpression) {
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
