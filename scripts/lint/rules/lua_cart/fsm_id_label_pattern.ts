import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind, type LuaTableField as TableField, LuaTableFieldKind as TableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { btIdLabelPatternRule } from './bt_id_label_pattern';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { containsLabel, lintCollectionStringValuesForLabel } from './impl/support/fsm_labels';
import { appendSuggestionMessage } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const fsmIdLabelPatternRule = defineLintRule('cart', 'fsm_id_label_pattern');

export function lintFsmIdLabelPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	if (!isGlobalCall(expression, 'define_fsm')) {
		return;
	}
	const idArgument = expression.arguments[0];
	if (!idArgument || idArgument.kind !== SyntaxKind.StringLiteralExpression) {
		return;
	}
	const fsmId = idArgument.value;
	if (!containsLabel(fsmId, 'fsm')) {
		return;
	}
	pushIssue(
		issues,
		fsmIdLabelPatternRule.name,
		idArgument,
		appendSuggestionMessage(
			`FSM id must not contain "fsm" ("${fsmId}").`,
			fsmId,
			'fsm',
		),
	);
}

export function lintCollectionLabelPatterns(field: TableField, issues: CartLintIssue[]): void {
	if (field.kind !== TableFieldKind.IdentifierKey) {
		return;
	}
	if (field.name === 'fsms') {
		lintCollectionStringValuesForLabel(
			field.value,
			'fsm',
			fsmIdLabelPatternRule.name,
			issues,
			'FSM id',
		);
		return;
	}
	if (field.name === 'bts') {
		lintCollectionStringValuesForLabel(
			field.value,
			'bt',
			btIdLabelPatternRule.name,
			issues,
			'Behavior-tree id',
		);
	}
}
