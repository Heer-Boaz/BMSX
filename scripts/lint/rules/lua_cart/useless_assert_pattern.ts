import { defineLintRule } from '../../rule';
import { type LuaIfStatement as IfStatement } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { matchesUselessAssertPattern } from './impl/support/general';
import { pushIssue } from './impl/support/lint_context';

export const uselessAssertPatternRule = defineLintRule('cart', 'useless_assert_pattern');

export function lintUselessAssertPattern(statement: IfStatement, lint: CartLintContext): void {
	if (!matchesUselessAssertPattern(statement)) {
		return;
	}
	pushIssue(
		lint,
		uselessAssertPatternRule.name,
		statement,
		'Useless assert-pattern is forbidden (if ... then error(...) end). Remove the check; do not replace it with another check/assert.',
	);
}
