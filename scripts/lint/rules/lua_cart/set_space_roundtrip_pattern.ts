import { defineLintRule } from '../../rule';
import { type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getCallMethodName } from '../../../../src/bmsx/lua/syntax/calls';
import { isGetSpaceCallExpression } from './impl/support/calls';
import { pushIssue } from './impl/support/lint_context';

export const setSpaceRoundtripPatternRule = defineLintRule('lua_cart', 'set_space_roundtrip_pattern');

export function lintSetSpaceRoundtripPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (getCallMethodName(expression) !== 'set_space' || expression.arguments.length !== 1) {
		return;
	}
	if (!isGetSpaceCallExpression(expression.arguments[0])) {
		return;
	}
	pushIssue(
		issues,
		setSpaceRoundtripPatternRule.name,
		expression,
		'set_space(get_space()) is forbidden. Set the target space directly instead of re-reading and re-applying the same space.',
	);
}
