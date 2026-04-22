import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { getCallMethodName, getCallReceiverName } from '../../../../src/bmsx/lua/syntax/calls';
import { FORBIDDEN_STATE_CALL_RECEIVERS } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenMatchesStatePathPatternRule = defineLintRule('cart', 'forbidden_matches_state_path_pattern');

export function lintForbiddenMatchesStatePathPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	const receiverName = getCallReceiverName(expression);
	if (!receiverName || !FORBIDDEN_STATE_CALL_RECEIVERS.has(receiverName) || getCallMethodName(expression) !== 'matches_state_path') {
		return;
	}
	pushIssue(
		issues,
		forbiddenMatchesStatePathPatternRule.name,
		expression,
		`Use of "${receiverName}:matches_state_path" is forbidden.`,
	);
}
