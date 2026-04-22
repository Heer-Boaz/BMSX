import { defineLintRule } from '../../rule';
import { LuaBinaryOperator as BinaryOperator, type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isDirectActionTriggeredCallExpression } from './impl/support/calls';
import { pushIssue } from './impl/support/lint_context';

export const actionTriggeredBoolChainPatternRule = defineLintRule('cart', 'action_triggered_bool_chain_pattern');

export function lintActionTriggeredBoolChainPattern(expression: Expression, issues: CartLintIssue[]): void {
	if (expression.kind !== SyntaxKind.BinaryExpression) {
		return;
	}
	if (expression.operator !== BinaryOperator.Or && expression.operator !== BinaryOperator.And) {
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
