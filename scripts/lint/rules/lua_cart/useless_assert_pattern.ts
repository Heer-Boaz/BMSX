import { defineLintRule } from '../../rule';
import { type LuaIfStatement as IfStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { matchesUselessAssertPattern } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const uselessAssertPatternRule = defineLintRule('cart', 'useless_assert_pattern');

export function lintUselessAssertPattern(statement: IfStatement, issues: CartLintIssue[]): void {
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
