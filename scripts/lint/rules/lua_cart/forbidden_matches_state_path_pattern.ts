import { defineLintRule } from '../../rule';
import { type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { pushIssue } from './impl/support/lint_context';

export const forbiddenMatchesStatePathPatternRule = defineLintRule('lua_cart', 'forbidden_matches_state_path_pattern');

export function lintForbiddenMatchesStatePathPattern(expression: LuaCallExpression, receiverName: string, issues: LuaLintIssue[]): void {
	pushIssue(
		issues,
		forbiddenMatchesStatePathPatternRule.name,
		expression,
		`Use of "${receiverName}:matches_state_path" is forbidden.`,
	);
}
