import { defineLintRule } from '../../rule';
import { type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getCallMethodName, getCallReceiverName } from '../../../../src/bmsx/lua/syntax/calls';
import { FORBIDDEN_STATE_CALL_RECEIVERS } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenMatchesStatePathPatternRule = defineLintRule('lua_cart', 'forbidden_matches_state_path_pattern');

export function lintForbiddenMatchesStatePathPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
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
