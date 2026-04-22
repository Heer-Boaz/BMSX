import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getCallMethodName } from '../../../../src/bmsx/lua/syntax/calls';
import { containsLabel } from './impl/support/fsm_labels';
import { appendSuggestionMessage } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const btIdLabelPatternRule = defineLintRule('lua_cart', 'bt_id_label_pattern');

export function lintBtIdLabelPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	const methodName = getCallMethodName(expression);
	if (methodName !== 'register_behaviour_tree' && methodName !== 'register_definition') {
		return;
	}
	const idArgument = expression.arguments[0];
	if (!idArgument || idArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return;
	}
	const btId = idArgument.value;
	if (!containsLabel(btId, 'bt')) {
		return;
	}
	pushIssue(
		issues,
		btIdLabelPatternRule.name,
		idArgument,
		appendSuggestionMessage(
			`Behavior-tree id must not contain "bt" ("${btId}").`,
			btId,
			'bt',
		),
	);
}
