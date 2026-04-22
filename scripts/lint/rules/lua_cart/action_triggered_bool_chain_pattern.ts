import { defineLintRule } from '../../rule';
import { LuaBinaryOperator, type LuaExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isDirectActionTriggeredCallExpression } from './impl/support/calls';
import { pushIssue } from './impl/support/lint_context';

export const actionTriggeredBoolChainPatternRule = defineLintRule('lua_cart', 'action_triggered_bool_chain_pattern');

export function lintActionTriggeredBoolChainPattern(expression: LuaExpression, issues: LuaLintIssue[]): void {
	if (expression.kind !== LuaSyntaxKind.BinaryExpression) {
		return;
	}
	if (expression.operator !== LuaBinaryOperator.Or && expression.operator !== LuaBinaryOperator.And) {
		return;
	}
	if (!isDirectActionTriggeredCallExpression(expression.left) || !isDirectActionTriggeredCallExpression(expression.right)) {
		return;
	}
	pushIssue(
		issues,
		actionTriggeredBoolChainPatternRule.name,
		expression,
		'Combining multiple action_triggered(...) calls with and/or is forbidden. Use one action_triggered query with complex action-query syntax instead.',
	);
}
