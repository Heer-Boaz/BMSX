import { defineLintRule } from '../../rule';
import { type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { lintForbiddenMatchesStatePathPattern } from './forbidden_matches_state_path_pattern';
import { getCallMethodName, getCallReceiverName } from './impl/support/calls';
import { FORBIDDEN_STATE_CALL_RECEIVERS } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenTransitionToPatternRule = defineLintRule('lua_cart', 'forbidden_transition_to_pattern');

export function lintForbiddenStateCalls(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	const receiverName = getCallReceiverName(expression);
	if (!receiverName || !FORBIDDEN_STATE_CALL_RECEIVERS.has(receiverName)) {
		return;
	}
	const methodName = getCallMethodName(expression);
	if (methodName === 'transition_to') {
		pushIssue(
			issues,
			forbiddenTransitionToPatternRule.name,
			expression,
			`Use of "${receiverName}:transition_to" is forbidden.`,
		);
		return;
	}
	lintForbiddenMatchesStatePathPattern(expression, issues);
}
