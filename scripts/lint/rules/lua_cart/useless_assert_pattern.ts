import { defineLintRule } from '../../rule';
import { type LuaIfStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { matchesUselessAssertPattern } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const uselessAssertPatternRule = defineLintRule('lua_cart', 'useless_assert_pattern');

export function lintUselessAssertPattern(statement: LuaIfStatement, issues: LuaLintIssue[]): void {
	if (!matchesUselessAssertPattern(statement)) {
		return;
	}
	pushIssue(
		issues,
		uselessAssertPatternRule.name,
		statement,
		'Useless assert-pattern is forbidden (if ... then error(...) end). Remove the check; do not replace it with another check/assert.',
	);
}
