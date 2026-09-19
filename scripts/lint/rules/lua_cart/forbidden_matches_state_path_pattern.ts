import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { getCallMethodName, getCallReceiverName } from '../../../../toolchain/ts/lua/syntax/calls';
import { FORBIDDEN_STATE_CALL_RECEIVERS } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenMatchesStatePathPatternRule = defineLintRule('cart', 'forbidden_matches_state_path_pattern');

export function lintForbiddenMatchesStatePathPattern(expression: CallExpression, lint: CartLintContext): void {
	const receiverName = getCallReceiverName(expression);
	if (!receiverName || !FORBIDDEN_STATE_CALL_RECEIVERS.has(receiverName) || getCallMethodName(expression) !== 'matches_state_path') {
		return;
	}
	pushIssue(
		lint,
		forbiddenMatchesStatePathPatternRule.name,
		expression,
		`Use of "${receiverName}:matches_state_path" is forbidden.`,
	);
}
